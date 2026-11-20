// 관리자 검수: 대기 중인 메뉴판 제보를 보고 승인(menus 에 반영) 또는 반려한다.
// 승인하면 그 가게의 기존 메뉴가 전부 이 제보의 메뉴로 교체된다.
import { MAX_PRICE_WON, MENU_CATEGORIES, MIN_PRICE_WON } from './menuPrice.js';
import { deletePhoto } from './menuSubmissions.js';

export class AdminError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const STATUSES = ['pending', 'approved', 'rejected'];
const MAX_NAME_LENGTH = 100;
const MAX_ITEMS = 300;
const MAX_NOTE_LENGTH = 500;

export function parseSubmissionId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0 || String(value) !== String(id)) {
    throw new AdminError(400, '제보 번호가 올바르지 않습니다.');
  }
  return id;
}

/** 관리자가 고친 메뉴 목록을 검사해 저장할 형태로 돌려준다. 문제가 있으면 AdminError(400). */
export function normalizeApprovedItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new AdminError(400, '승인할 메뉴가 없습니다. 메뉴를 한 개 이상 남겨 주세요.');
  }
  if (items.length > MAX_ITEMS) {
    throw new AdminError(400, `메뉴는 최대 ${MAX_ITEMS}개까지 승인할 수 있습니다.`);
  }

  return items.map((item, index) => {
    const label = `${index + 1}번째 메뉴`;
    const name = typeof item?.name === 'string' ? item.name.trim() : '';
    if (!name || name.length > MAX_NAME_LENGTH) {
      throw new AdminError(400, `${label}: 메뉴 이름이 비었거나 너무 깁니다.`);
    }
    const price = item?.price_won;
    if (!Number.isInteger(price) || price < MIN_PRICE_WON || price > MAX_PRICE_WON) {
      throw new AdminError(
        400,
        `${label}(${name}): 가격은 ${MIN_PRICE_WON}~${MAX_PRICE_WON}원 사이의 정수여야 합니다.`
      );
    }
    if (!MENU_CATEGORIES.includes(item?.category)) {
      throw new AdminError(400, `${label}(${name}): 분류를 meal/side/drink/alcohol 중에서 골라 주세요.`);
    }
    return { name, price_won: price, category: item.category };
  });
}

function cleanNote(note) {
  if (note == null || note === '') return null;
  if (typeof note !== 'string') throw new AdminError(400, '메모 형식이 올바르지 않습니다.');
  const trimmed = note.trim();
  if (trimmed.length > MAX_NOTE_LENGTH) {
    throw new AdminError(400, `메모는 ${MAX_NOTE_LENGTH}자 이하로 써 주세요.`);
  }
  return trimmed || null;
}

const toSummary = row => ({
  submission_id: Number(row.submission_id),
  merchant_id: row.merchant_id,
  merchant_name: row.merchant_name,
  merchant_address: row.merchant_address,
  submitted_email: row.submitted_email,
  status: row.status,
  has_uncertain: row.has_uncertain,
  item_count: Number(row.item_count),
  created_at: row.created_at,
  reviewed_at: row.reviewed_at,
});

/** 제보 목록(기본은 검수 대기). 오래된 것부터 보여 준다. */
export async function listSubmissions(db, { status = 'pending', limit = 100 } = {}) {
  if (!STATUSES.includes(status)) throw new AdminError(400, '상태 값이 올바르지 않습니다.');
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 200);

  const result = await db.query(
    `SELECT submission_id, merchant_id, merchant_name, merchant_address, submitted_email,
            status, has_uncertain, jsonb_array_length(items) AS item_count,
            created_at, reviewed_at
       FROM public.menu_submissions
      WHERE status = $1
      ORDER BY created_at ${status === 'pending' ? 'ASC' : 'DESC'}, submission_id
      LIMIT $2`,
    [status, safeLimit]
  );
  return result.rows.map(toSummary);
}

/** 제보 한 건의 전체 내용. 없으면 null. */
export async function getSubmission(db, submissionId) {
  const result = await db.query(
    `SELECT submission_id, merchant_id, merchant_name, merchant_address, submitted_email,
            status, has_uncertain, jsonb_array_length(items) AS item_count,
            created_at, reviewed_at, items, rejected, model, photo_path, review_note
       FROM public.menu_submissions WHERE submission_id = $1`,
    [submissionId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    ...toSummary(row),
    items: row.items,
    rejected: row.rejected,
    model: row.model,
    has_photo: Boolean(row.photo_path),
    review_note: row.review_note,
  };
}

/** 사진 파일 이름. 제보가 없거나 사진이 이미 지워졌으면 null. */
export async function getPhotoName(db, submissionId) {
  const result = await db.query(
    'SELECT photo_path FROM public.menu_submissions WHERE submission_id = $1',
    [submissionId]
  );
  return result.rows[0]?.photo_path ?? null;
}

async function withTransaction(db, work) {
  const client = typeof db.connect === 'function' ? await db.connect() : db;
  try {
    await client.query('BEGIN');
    const value = await work(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    if (client !== db) client.release();
  }
}

async function lockPending(client, submissionId) {
  const found = await client.query(
    `SELECT submission_id, merchant_id, status, items, photo_path
       FROM public.menu_submissions WHERE submission_id = $1 FOR UPDATE`,
    [submissionId]
  );
  const row = found.rows[0];
  if (!row) throw new AdminError(404, '제보를 찾을 수 없습니다.');
  if (row.status !== 'pending') {
    throw new AdminError(409, '이미 처리된 제보입니다.');
  }
  return row;
}

/**
 * 제보를 승인한다. items 를 주면 관리자가 고친 목록으로, 안 주면 OCR 결과 중
 * 자동 확인(ok)된 항목만으로 저장한다. 확신 없는(uncertain) 항목은 관리자가 직접 고쳐서 보내야 들어간다.
 * 가게의 기존 메뉴는 모두 지우고 이 목록으로 교체한다.
 */
export async function approveSubmission(db, submissionId, { items, note, reviewer }) {
  const reviewNote = cleanNote(note);

  const row = await withTransaction(db, async client => {
    const submission = await lockPending(client, submissionId);

    const source =
      items !== undefined
        ? items
        : (submission.items ?? []).filter(item => item.status === 'ok');
    const approved = normalizeApprovedItems(source);

    await client.query('DELETE FROM public.menus WHERE merchant_id = $1', [submission.merchant_id]);
    for (const item of approved) {
      await client.query(
        `INSERT INTO public.menus (merchant_id, submission_id, name, price_won, category, verified_at)
         VALUES ($1, $2, $3, $4, $5, now())`,
        [submission.merchant_id, submissionId, item.name, item.price_won, item.category]
      );
    }
    await client.query(
      `UPDATE public.menu_submissions
          SET status = 'approved', reviewed_by = $2, reviewed_at = now(), review_note = $3,
              photo_path = NULL
        WHERE submission_id = $1`,
      [submissionId, reviewer?.id ?? null, reviewNote]
    );
    return { merchant_id: submission.merchant_id, photo_path: submission.photo_path, count: approved.length };
  });

  // 사진은 DB 에 반영된 뒤에 지운다. 지우기에 실패해도 승인 결과는 유지한다.
  await deletePhoto(row.photo_path).catch(error =>
    console.error('승인 후 사진 삭제 실패:', error.message)
  );
  return { submission_id: submissionId, status: 'approved', merchant_id: row.merchant_id, menu_count: row.count };
}

/** 제보를 반려한다. 기존에 승인된 메뉴는 건드리지 않는다. */
export async function rejectSubmission(db, submissionId, { note, reviewer }) {
  const reviewNote = cleanNote(note);

  const row = await withTransaction(db, async client => {
    const submission = await lockPending(client, submissionId);
    await client.query(
      `UPDATE public.menu_submissions
          SET status = 'rejected', reviewed_by = $2, reviewed_at = now(), review_note = $3,
              photo_path = NULL
        WHERE submission_id = $1`,
      [submissionId, reviewer?.id ?? null, reviewNote]
    );
    return submission;
  });

  await deletePhoto(row.photo_path).catch(error =>
    console.error('반려 후 사진 삭제 실패:', error.message)
  );
  return { submission_id: submissionId, status: 'rejected', merchant_id: row.merchant_id };
}
