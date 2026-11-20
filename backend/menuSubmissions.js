// 메뉴판 제보 저장: OCR 결과를 menu_submissions(검수 대기)에 넣고, 원본 사진을 비공개로 보관한다.
// 사진은 관리자가 OCR 결과와 대조할 때까지만 보관하고, 승인·반려 후 삭제한다.
// 지금은 로컬 폴더에 저장한다. 배포 환경(파일이 사라지는 서버)에서는 Supabase Storage 등으로 바꿀 곳이다.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PHOTO_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

// merchant_id 형식이 바뀌어도(숫자만, 지역코드-숫자 등) 통과하되, 경로·SQL 조작 문자는 막는다.
const MERCHANT_ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

export function isValidMerchantId(value) {
  return typeof value === 'string' && MERCHANT_ID_PATTERN.test(value);
}

export function photoDir() {
  return (
    process.env.MENU_PHOTO_DIR ||
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'uploads', 'menu-photos')
  );
}

/** 사진을 저장하고 파일 이름(photo_path에 넣을 값)을 돌려준다. 이름은 서버가 정한다. */
export async function savePhoto(buffer, mimeType) {
  const ext = PHOTO_EXTENSIONS[mimeType];
  if (!ext) throw new Error('지원하지 않는 이미지 형식입니다.');

  const dir = photoDir();
  await fs.mkdir(dir, { recursive: true });

  const name = `${crypto.randomUUID()}.${ext}`;
  await fs.writeFile(path.join(dir, name), buffer, { flag: 'wx' });
  return name;
}

/** 보관 중인 사진을 지운다. 없어도 오류로 보지 않는다. */
export async function deletePhoto(name) {
  if (!name) return;
  await fs.rm(path.join(photoDir(), path.basename(name)), { force: true });
}

export async function merchantExists(db, merchantId) {
  const result = await db.query(
    'SELECT 1 FROM public.merchants WHERE merchant_id = $1',
    [merchantId]
  );
  return result.rows.length > 0;
}

/**
 * OCR 결과를 검수 대기 제보로 저장한다.
 * 사진을 먼저 저장하고 DB에 넣으며, DB 저장이 실패하면 사진도 지운다.
 *
 * @param db      pg Pool 또는 query(sql, params)를 가진 객체
 * @param options { merchantId, buffer, mimeType, ocr: { items, rejected, model }, user? }
 *   user: 로그인 기능이 붙으면 { id, email }. 아직 없으면 비워 둔다.
 */
export async function submitMenuPhoto(db, { merchantId, buffer, mimeType, ocr, user }) {
  const photoPath = await savePhoto(buffer, mimeType);

  try {
    const hasUncertain = ocr.items.some(item => item.status === 'uncertain');

    const result = await db.query(
      `INSERT INTO public.menu_submissions
         (merchant_id, submitted_by, submitted_email, photo_path,
          items, rejected, model, has_uncertain)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8)
       RETURNING submission_id, status, created_at`,
      [
        merchantId,
        user?.id ?? null,
        user?.email ?? null,
        photoPath,
        JSON.stringify(ocr.items),
        JSON.stringify(ocr.rejected ?? []),
        ocr.model ?? null,
        hasUncertain,
      ]
    );

    const row = result.rows[0];
    return {
      submission_id: Number(row.submission_id),
      status: row.status,
      created_at: row.created_at,
      merchant_id: merchantId,
      model: ocr.model ?? null,
      has_uncertain: hasUncertain,
      items: ocr.items,
      rejected: ocr.rejected ?? [],
    };
  } catch (error) {
    await deletePhoto(photoPath).catch(() => {});
    throw error;
  }
}
