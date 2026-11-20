import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  AdminError,
  approveSubmission,
  listSubmissions,
  normalizeApprovedItems,
  parseSubmissionId,
  rejectSubmission,
} from './menuAdmin.js';

// 쿼리를 기록하고, 정해 둔 응답을 돌려주는 가짜 DB
function fakeDb(handlers = {}) {
  const calls = [];
  const client = {
    calls,
    async query(sql, params) {
      const text = sql.replace(/\s+/g, ' ').trim();
      calls.push({ sql: text, params });
      for (const [pattern, reply] of Object.entries(handlers)) {
        if (text.includes(pattern)) return typeof reply === 'function' ? reply(params) : reply;
      }
      return { rows: [] };
    },
    release() { this.released = true; },
  };
  return { db: { connect: async () => client, query: client.query.bind(client) }, client, calls };
}

const pendingRow = (overrides = {}) => ({
  rows: [{
    submission_id: 7,
    merchant_id: '123',
    status: 'pending',
    photo_path: null,
    items: [
      { name: '김치찌개', price_won: 9000, category: 'meal', status: 'ok' },
      { name: '공기밥', price_won: 1000, category: 'side', status: 'uncertain' },
    ],
    ...overrides,
  }],
});

test('제보 번호는 양의 정수 문자열만 받는다', () => {
  assert.equal(parseSubmissionId('12'), 12);
  for (const bad of ['0', '-1', '1.5', 'abc', '1; DROP', '', '012']) {
    assert.throws(() => parseSubmissionId(bad), AdminError, bad);
  }
});

test('승인 메뉴 검사: 이름·가격·분류가 올바르면 저장 형태로 돌려준다', () => {
  assert.deepEqual(
    normalizeApprovedItems([{ name: ' 김치찌개 ', price_won: 9000, category: 'meal', extra: 1 }]),
    [{ name: '김치찌개', price_won: 9000, category: 'meal' }]
  );
});

test('승인 메뉴 검사: 빈 목록·잘못된 값은 400', () => {
  const bad = [
    [],
    'x',
    [{ name: '', price_won: 9000, category: 'meal' }],
    [{ name: '밥', price_won: 90.5, category: 'meal' }],
    [{ name: '밥', price_won: '9000', category: 'meal' }],
    [{ name: '밥', price_won: 100, category: 'meal' }],
    [{ name: '밥', price_won: 9000000, category: 'meal' }],
    [{ name: '밥', price_won: 9000, category: 'unknown' }],
    [{ name: 'a'.repeat(101), price_won: 9000, category: 'meal' }],
  ];
  for (const items of bad) {
    assert.throws(() => normalizeApprovedItems(items), error => error instanceof AdminError && error.status === 400);
  }
});

test('목록: 상태 값이 이상하면 400, 대기 목록은 오래된 순', async () => {
  const { db, calls } = fakeDb({ 'FROM public.menu_submissions': { rows: [] } });
  await assert.rejects(listSubmissions(db, { status: 'x; DROP' }), AdminError);
  await listSubmissions(db, { status: 'pending' });
  assert.match(calls.at(-1).sql, /ORDER BY created_at ASC/);
  await listSubmissions(db, { status: 'approved', limit: 100000 });
  assert.equal(calls.at(-1).params[1], 200);
});

test('승인(교체): 관리자가 보낸 목록으로 가게 메뉴를 통째로 교체하고 하나의 트랜잭션으로 처리한다', async () => {
  const { db, client } = fakeDb({
    'FOR UPDATE': pendingRow(),
    'DELETE FROM public.menus': { rows: [], rowCount: 5 },
  });
  const result = await approveSubmission(db, 7, {
    items: [
      { name: '김치찌개', price_won: 9000, category: 'meal' },
      { name: '공기밥', price_won: 1000, category: 'side' },
    ],
    note: ' 확인함 ',
    reviewer: { id: 'u1' },
    mode: 'replace',
  });

  assert.deepEqual(result, {
    submission_id: 7, status: 'approved', merchant_id: '123',
    mode: 'replace', menu_count: 2, added: 2, updated: 0, removed: 5,
  });
  const sqls = client.calls.map(c => c.sql);
  assert.equal(sqls[0], 'BEGIN');
  assert.ok(sqls[1].includes('FOR UPDATE'));
  assert.ok(sqls[2].includes('pg_advisory_xact_lock'));
  assert.ok(sqls[3].startsWith('DELETE FROM public.menus'));
  assert.equal(sqls.filter(s => s.startsWith('INSERT INTO public.menus')).length, 2);
  assert.ok(sqls.some(s => s.includes("status = 'approved'")));
  assert.equal(sqls.at(-1), 'COMMIT');
  assert.equal(client.released, true);
  const update = client.calls.find(c => c.sql.includes("status = 'approved'"));
  assert.deepEqual(update.params, [7, 'u1', '확인함']);
});

test('승인(추가, 기본값): 같은 이름은 새 가격으로 바꾸고, 새 메뉴는 더하고, 나머지 기존 메뉴는 남긴다', async () => {
  const { db, client } = fakeDb({
    'FOR UPDATE': pendingRow(),
    'SELECT menu_id, name FROM public.menus': {
      rows: [
        { menu_id: '11', name: '김치 찌개' }, // 띄어쓰기가 달라도 같은 메뉴로 본다
        { menu_id: '12', name: '공기밥' },
        { menu_id: '13', name: '콜라' },
      ],
    },
  });
  const result = await approveSubmission(db, 7, {
    items: [
      { name: '김치찌개', price_won: 9500, category: 'meal' },
      { name: '라면', price_won: 5000, category: 'meal' },
    ],
    reviewer: { id: 'u1' },
  });

  assert.deepEqual(result, {
    submission_id: 7, status: 'approved', merchant_id: '123',
    mode: 'merge', menu_count: 4, added: 1, updated: 1, removed: 0,
  });
  const sqls = client.calls.map(c => c.sql);
  assert.ok(!sqls.some(s => s.startsWith('DELETE')), '추가 모드는 기존 메뉴를 지우지 않는다');
  const update = client.calls.find(c => c.sql.startsWith('UPDATE public.menus'));
  assert.deepEqual(update.params, [['11'], '김치찌개', 9500, 'meal', 7]);
  const inserts = client.calls.filter(c => c.sql.startsWith('INSERT INTO public.menus'));
  assert.equal(inserts.length, 1);
  assert.deepEqual(inserts[0].params, ['123', 7, '라면', 5000, 'meal']);
  assert.equal(sqls.at(-1), 'COMMIT');
});

test('승인: 같은 가게의 승인이 동시에 일어나도 엉키지 않게 가게 단위로 잠근다', async () => {
  const { db, client } = fakeDb({ 'FOR UPDATE': pendingRow() });
  await approveSubmission(db, 7, { items: [{ name: '라면', price_won: 5000, category: 'meal' }], reviewer: {} });
  const lock = client.calls.find(c => c.sql.includes('pg_advisory_xact_lock'));
  assert.deepEqual(lock.params, ['menus:123']);
});

test('승인: 목록 안에 같은 이름이 두 번 있으면 마지막 것만 저장한다', async () => {
  const { db, client } = fakeDb({ 'FOR UPDATE': pendingRow() });
  const result = await approveSubmission(db, 7, {
    items: [
      { name: '라면', price_won: 4000, category: 'meal' },
      { name: '라 면', price_won: 4500, category: 'meal' },
    ],
    reviewer: {},
    mode: 'replace',
  });
  assert.equal(result.menu_count, 1);
  const inserts = client.calls.filter(c => c.sql.startsWith('INSERT INTO public.menus'));
  assert.deepEqual(inserts.map(c => c.params[3]), [4500]);
});

test('승인: 승인 방식이 merge/replace 가 아니면 400 이고 DB 를 건드리지 않는다', async () => {
  const { db, client } = fakeDb({ 'FOR UPDATE': pendingRow() });
  await assert.rejects(
    approveSubmission(db, 7, { items: [{ name: '라면', price_won: 5000, category: 'meal' }], reviewer: {}, mode: 'delete-all' }),
    e => e.status === 400
  );
  assert.equal(client.calls.length, 0);
});

test('승인: items 를 안 보내면 자동 확인(ok)된 항목만 저장한다', async () => {
  const { db, client } = fakeDb({ 'FOR UPDATE': pendingRow() });
  const result = await approveSubmission(db, 7, { reviewer: { id: 'u1' } });
  assert.equal(result.menu_count, 1);
  const inserts = client.calls.filter(c => c.sql.startsWith('INSERT INTO public.menus'));
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].params[2], '김치찌개');
});

test('승인: 이미 처리된 제보는 409 이고 아무것도 바꾸지 않는다(ROLLBACK)', async () => {
  const { db, client } = fakeDb({ 'FOR UPDATE': pendingRow({ status: 'approved' }) });
  await assert.rejects(
    approveSubmission(db, 7, { items: [{ name: '밥', price_won: 5000, category: 'meal' }], reviewer: {} }),
    error => error.status === 409
  );
  const sqls = client.calls.map(c => c.sql);
  assert.ok(!sqls.some(s => s.startsWith('DELETE') || s.startsWith('INSERT')));
  assert.equal(sqls.at(-1), 'ROLLBACK');
});

test('승인: 없는 제보는 404, 잘못된 메뉴는 400 이며 기존 메뉴를 지우지 않는다', async () => {
  const none = fakeDb({ 'FOR UPDATE': { rows: [] } });
  await assert.rejects(approveSubmission(none.db, 9, { items: [], reviewer: {} }), e => e.status === 404);

  const { db, client } = fakeDb({ 'FOR UPDATE': pendingRow() });
  await assert.rejects(
    approveSubmission(db, 7, { items: [{ name: '밥', price_won: 1, category: 'meal' }], reviewer: {} }),
    e => e.status === 400
  );
  assert.ok(!client.calls.some(c => c.sql.startsWith('DELETE')));
  assert.equal(client.calls.at(-1).sql, 'ROLLBACK');
});

test('승인: 메뉴 저장 중 DB 오류가 나면 ROLLBACK 하고 오류를 그대로 올린다', async () => {
  const { db, client } = fakeDb({
    'FOR UPDATE': pendingRow(),
    'INSERT INTO public.menus': () => { throw new Error('db down'); },
  });
  await assert.rejects(
    approveSubmission(db, 7, { items: [{ name: '밥', price_won: 5000, category: 'meal' }], reviewer: {} }),
    /db down/
  );
  assert.equal(client.calls.at(-1).sql, 'ROLLBACK');
  assert.equal(client.released, true);
});

test('반려: 상태만 바꾸고 메뉴는 건드리지 않는다', async () => {
  const { db, client } = fakeDb({ 'FOR UPDATE': pendingRow() });
  const result = await rejectSubmission(db, 7, { note: '사진이 흐림', reviewer: { id: 'u1' } });
  assert.deepEqual(result, { submission_id: 7, status: 'rejected', merchant_id: '123' });
  assert.ok(!client.calls.some(c => c.sql.includes('public.menus')));
  assert.ok(client.calls.some(c => c.sql.includes("status = 'rejected'")));
  assert.equal(client.calls.at(-1).sql, 'COMMIT');
});

test('반려: 이미 처리된 제보는 409', async () => {
  const { db } = fakeDb({ 'FOR UPDATE': pendingRow({ status: 'rejected' }) });
  await assert.rejects(rejectSubmission(db, 7, { reviewer: {} }), e => e.status === 409);
});

test('승인·반려가 끝나면 보관 중이던 사진을 지운다', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'menu-admin-'));
  process.env.MENU_PHOTO_DIR = dir;
  try {
    for (const action of ['approve', 'reject']) {
      const file = `${action}.jpg`;
      await fs.writeFile(path.join(dir, file), 'x');
      const { db } = fakeDb({ 'FOR UPDATE': pendingRow({ photo_path: file }) });
      if (action === 'approve') {
        await approveSubmission(db, 7, { items: [{ name: '밥', price_won: 5000, category: 'meal' }], reviewer: {} });
      } else {
        await rejectSubmission(db, 7, { reviewer: {} });
      }
      await assert.rejects(fs.access(path.join(dir, file)), '사진이 지워져야 한다');
    }
  } finally {
    delete process.env.MENU_PHOTO_DIR;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('메모가 너무 길면 400', async () => {
  const { db } = fakeDb({ 'FOR UPDATE': pendingRow() });
  await assert.rejects(rejectSubmission(db, 7, { note: 'a'.repeat(501), reviewer: {} }), e => e.status === 400);
});
