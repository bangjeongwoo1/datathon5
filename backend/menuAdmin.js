// 관리자 검수: 대기 중인 메뉴판 제보를 보고 승인(menus 에 반영) 또는 반려한다.
// 승인하면 그 가게의 기존 메뉴가 전부 이 제보의 메뉴로 교체된다.
import { MAX_PRICE_WON, MENU_CATEGORIES, MIN_PRICE_WON } from './menuPrice.js';
import { deletePhotos, photoNamesOf } from './menuSubmissions.js';

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
            created_at, reviewed_at, items, rejected, model, photo_path, photo_paths, review_note
       FROM public.menu_submissions WHERE submission_id = $1`,
    [submissionId]
  );
  const row = result.rows[0];
  if (!row) return null;

  // 승인 전에 "지금 이 가게에 등록된 메뉴"를 같이 보여 주기 위해 함께 돌려준다.
  const current = await db.query(
    `SELECT name, price_won, category FROM public.menus
      WHERE merchant_id = $1 ORDER BY category, price_won, name`,
    [row.merchant_id]
  );

  return {
    ...toSummary(row),
    items: row.items,
    rejected: row.rejected,
    model: row.model,
    has_photo: photoNamesOf(row).length > 0,
    photo_count: photoNamesOf(row).length, // 보관 중인 사진 장수(승인·반려 후에는 0)
    review_note: row.review_note,
    current_menus: current.rows.map(menu => ({
      name: menu.name,
      price_won: Number(menu.price_won),
      category: menu.category,
    })),
  };
}

/** index 번째(0부터) 사진 파일 이름. 제보가 없거나, 그 사진이 없거나, 이미 지워졌으면 null. */
export async function getPhotoName(db, submissionId, index = 0) {
  const result = await db.query(
    'SELECT photo_path, photo_paths FROM public.menu_submissions WHERE submission_id = $1',
    [submissionId]
  );
  return photoNamesOf(result.rows[0])[index] ?? null;
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
    `SELECT submission_id, merchant_id, status, items, photo_path, photo_paths
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

// 승인 방식
//   merge   : 기존 메뉴에 추가한다. 이름이 같은 메뉴(띄어쓰기·대소문자 무시)는 새 가격·분류로 바꾸고,
//             이번 목록에 없는 기존 메뉴는 그대로 둔다. 메뉴판이 여러 장인 가게를 위해 기본값이다.
//   replace : 기존 메뉴를 모두 지우고 이번 목록으로 바꾼다. 메뉴판이 통째로 바뀌었을 때 쓴다.
export const APPROVE_MODES = ['merge', 'replace'];

/** 같은 메뉴인지 비교하기 위한 이름. 띄어쓰기와 대소문자를 무시한다. */
export function normalizeMenuName(name) {
  return String(name).toLowerCase().replace(/\s+/g, '');
}

// 같은 이름이 목록에 두 번 있으면 마지막 것을 쓴다.
function dedupeByName(items) {
  const byName = new Map();
  for (const item of items) byName.set(normalizeMenuName(item.name), item);
  return [...byName.values()];
}

async function insertMenu(client, merchantId, submissionId, item) {
  await client.query(
    `INSERT INTO public.menus (merchant_id, submission_id, name, price_won, category, verified_at)
     VALUES ($1, $2, $3, $4, $5, now())`,
    [merchantId, submissionId, item.name, item.price_won, item.category]
  );
}

/**
 * 제보를 승인한다. items 를 주면 관리자가 고친 목록으로, 안 주면 OCR 결과 중
 * 자동 확인(ok)된 항목만으로 저장한다. 확신 없는(uncertain) 항목은 관리자가 직접 고쳐서 보내야 들어간다.
 * mode 가 'merge'(기본)면 기존 메뉴에 추가하고, 'replace'면 기존 메뉴를 모두 이 목록으로 바꾼다.
 */
export async function approveSubmission(db, submissionId, { items, note, reviewer, mode = 'merge' }) {
  const reviewNote = cleanNote(note);
  if (!APPROVE_MODES.includes(mode)) {
    throw new AdminError(400, '승인 방식은 merge(추가) 또는 replace(교체)여야 합니다.');
  }

  const row = await withTransaction(db, async client => {
    const submission = await lockPending(client, submissionId);
    const merchantId = submission.merchant_id;

    const source =
      items !== undefined
        ? items
        : (submission.items ?? []).filter(item => item.status === 'ok');
    const approved = dedupeByName(normalizeApprovedItems(source));

    // 같은 가게의 다른 제보가 동시에 승인되어 메뉴가 엉키지 않도록, 가게 단위로 차례를 세운다.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`menus:${merchantId}`]);

    let added = 0;
    let updated = 0;
    let removed = 0;
    let total = 0;

    if (mode === 'replace') {
      const deleted = await client.query('DELETE FROM public.menus WHERE merchant_id = $1', [merchantId]);
      removed = deleted.rowCount ?? 0;
      for (const item of approved) await insertMenu(client, merchantId, submissionId, item);
      added = approved.length;
      total = approved.length;
    } else {
      const existing = await client.query(
        'SELECT menu_id, name FROM public.menus WHERE merchant_id = $1',
        [merchantId]
      );
      const idsByName = new Map();
      for (const menu of existing.rows) {
        const key = normalizeMenuName(menu.name);
        idsByName.set(key, [...(idsByName.get(key) ?? []), menu.menu_id]);
      }
      for (const item of approved) {
        const ids = idsByName.get(normalizeMenuName(item.name));
        if (ids) {
          await client.query(
            `UPDATE public.menus
                SET name = $2, price_won = $3, category = $4, submission_id = $5, verified_at = now()
              WHERE menu_id = ANY($1::bigint[])`,
            [ids, item.name, item.price_won, item.category, submissionId]
          );
          updated += 1;
        } else {
          await insertMenu(client, merchantId, submissionId, item);
          added += 1;
        }
      }
      total = existing.rows.length + added;
    }

    await client.query(
      `UPDATE public.menu_submissions
          SET status = 'approved', reviewed_by = $2, reviewed_at = now(), review_note = $3,
              photo_path = NULL, photo_paths = NULL
        WHERE submission_id = $1`,
      [submissionId, reviewer?.id ?? null, reviewNote]
    );
    return { merchantId, photoNames: photoNamesOf(submission), total, added, updated, removed };
  });

  // 사진은 DB 에 반영된 뒤에 지운다. 지우기에 실패해도 승인 결과는 유지한다.
  await deletePhotos(row.photoNames).catch(error =>
    console.error('승인 후 사진 삭제 실패:', error.message)
  );
  return {
    submission_id: submissionId,
    status: 'approved',
    merchant_id: row.merchantId,
    mode,
    menu_count: row.total, // 승인 후 이 가게에 등록된 메뉴 수
    added: row.added,
    updated: row.updated,
    removed: row.removed,
  };
}

/** 제보를 반려한다. 기존에 승인된 메뉴는 건드리지 않는다. */
export async function rejectSubmission(db, submissionId, { note, reviewer }) {
  const reviewNote = cleanNote(note);

  const row = await withTransaction(db, async client => {
    const submission = await lockPending(client, submissionId);
    await client.query(
      `UPDATE public.menu_submissions
          SET status = 'rejected', reviewed_by = $2, reviewed_at = now(), review_note = $3,
              photo_path = NULL, photo_paths = NULL
        WHERE submission_id = $1`,
      [submissionId, reviewer?.id ?? null, reviewNote]
    );
    return submission;
  });

  await deletePhotos(photoNamesOf(row)).catch(error =>
    console.error('반려 후 사진 삭제 실패:', error.message)
  );
  return { submission_id: submissionId, status: 'rejected', merchant_id: row.merchant_id };
}
