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

// 가게 번호(merchant_id)가 실제 있는 번호인지 확인하는 "가게 목록" 테이블.
// 가게 정보의 메인 테이블은 merchant_crawl_staging 이므로 기본이 이것이다.
// staging 표가 없는 옛 로컬 DB 에서만 .env 에 MERCHANT_SOURCE_TABLE=merchants 를 적어 쓴다.
// 테이블 이름은 SQL 에 들어가므로 아래 목록에 있는 것만 허용한다.
const MERCHANT_SOURCES = {
  // 표마다 가게 이름·주소 칸의 이름이 다르다.
  merchants: { name: 'name', address: 'address' },
  merchant_crawl_staging: { name: '"mrhstNm"', address: '"rdnmadr"' },
};

export function merchantSourceTable() {
  const name = process.env.MERCHANT_SOURCE_TABLE || 'merchant_crawl_staging';
  if (!Object.hasOwn(MERCHANT_SOURCES, name)) {
    throw new Error(
      `MERCHANT_SOURCE_TABLE은 ${Object.keys(MERCHANT_SOURCES).join(', ')} 중 하나여야 합니다. (현재 값: ${name})`
    );
  }
  return name;
}

/**
 * 가게 번호로 가게를 찾아 { name, address }를 돌려준다. 없으면 null.
 * 이름·주소는 제보에 함께 저장해 두었다가, 나중에 가게 번호 체계가 바뀔 때 다시 연결하는 데 쓴다.
 */
export async function findMerchant(db, merchantId) {
  const table = merchantSourceTable();
  const cols = MERCHANT_SOURCES[table];
  try {
    const result = await db.query(
      `SELECT ${cols.name} AS name, ${cols.address} AS address
         FROM public.${table} WHERE merchant_id = $1`,
      [merchantId]
    );
    if (result.rows.length === 0) return null;
    const { name, address } = result.rows[0];
    return { name: name ?? null, address: address ?? null };
  } catch (error) {
    if (error.code === '42P01') {
      // 테이블이 없는 DB에 접속한 경우: 원인과 해결 방법을 서버 로그에 남긴다.
      throw new Error(
        `가게 목록 테이블 public.${table} 이(가) 이 DB에 없습니다. ` +
          '가게 정보 표(merchant_crawl_staging)가 없는 옛 로컬 DB 라면 backend/.env 에 MERCHANT_SOURCE_TABLE=merchants 를 적어 주세요.'
      );
    }
    throw error;
  }
}

export async function merchantExists(db, merchantId) {
  return (await findMerchant(db, merchantId)) !== null;
}

/** 보관 중인 사진 여러 장을 지운다. 없어도 오류로 보지 않는다. */
export async function deletePhotos(names) {
  await Promise.all((names ?? []).filter(Boolean).map(name => deletePhoto(name)));
}

/** 제보 행에서 보관 중인 사진 이름 목록을 꺼낸다. (예전 제보는 photo_path 한 장만 있다.) */
export function photoNamesOf(row) {
  if (Array.isArray(row?.photo_paths) && row.photo_paths.length) return row.photo_paths.filter(Boolean);
  return row?.photo_path ? [row.photo_path] : [];
}

/**
 * OCR 결과를 검수 대기 제보로 저장한다.
 * 사진을 먼저 저장하고 DB에 넣으며, DB 저장이 실패하면 사진도 지운다.
 *
 * @param db      pg Pool 또는 query(sql, params)를 가진 객체
 * @param options { merchantId, merchant?, photos: [{ buffer, mimeType }], ocr: { items, rejected, model }, user? }
 *   photos: 올린 순서대로의 사진(최대 5장). 예전처럼 buffer, mimeType 한 장만 줘도 된다.
 *   merchant: findMerchant 가 찾은 { name, address }. 제출 당시의 가게 이름·주소로 함께 저장한다.
 *   user: 로그인 기능이 붙으면 { id, email }. 아직 없으면 비워 둔다.
 */
export async function submitMenuPhoto(db, { merchantId, merchant, photos, buffer, mimeType, ocr, user }) {
  const list = photos ?? [{ buffer, mimeType }];
  const photoPaths = [];
  try {
    for (const photo of list) photoPaths.push(await savePhoto(photo.buffer, photo.mimeType));
  } catch (error) {
    await deletePhotos(photoPaths).catch(() => {});
    throw error;
  }

  try {
    const hasUncertain = ocr.items.some(item => item.status === 'uncertain');

    const result = await db.query(
      `INSERT INTO public.menu_submissions
         (merchant_id, submitted_by, submitted_email, photo_path,
          items, rejected, model, has_uncertain, merchant_name, merchant_address, photo_paths)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, $11::text[])
       RETURNING submission_id, status, created_at`,
      [
        merchantId,
        user?.id ?? null,
        user?.email ?? null,
        photoPaths[0], // 예전 코드와 맞추기 위해 첫 장을 함께 적는다.
        JSON.stringify(ocr.items),
        JSON.stringify(ocr.rejected ?? []),
        ocr.model ?? null,
        hasUncertain,
        merchant?.name ?? null,
        merchant?.address ?? null,
        photoPaths,
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
      photo_count: photoPaths.length,
      items: ocr.items,
      rejected: ocr.rejected ?? [],
    };
  } catch (error) {
    await deletePhotos(photoPaths).catch(() => {});
    throw error;
  }
}
