import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createAdminRouter } from './adminRoutes.js';

// 실제 HTTP 로 주소·상태 코드·사진 응답을 확인한다. DB 는 가짜.
async function withServer(rows, fn) {
  const db = {
    async query(sql) {
      const text = sql.replace(/\s+/g, ' ');
      if (text.includes('SELECT photo_path')) return { rows: rows.photo ?? [] };
      if (text.includes('jsonb_array_length(items) AS item_count') && text.includes('items, rejected')) return { rows: rows.detail ?? [] };
      if (text.includes('FROM public.menus')) return { rows: rows.menus ?? [] };
      return { rows: rows.list ?? [] };
    },
  };
  const app = express();
  app.use(express.json());
  app.use('/api/admin', (req, res, next) => { req.user = { id: 'u1', email: 'boss@example.com' }; next(); }, createAdminRouter({ db }));
  const server = app.listen(0);
  try {
    await fn(`http://127.0.0.1:${server.address().port}/api/admin`);
  } finally {
    server.close();
  }
}

test('목록·상세·없는 제보·잘못된 번호의 응답 코드', async () => {
  await withServer({
    list: [{ submission_id: 1, merchant_id: 'a', status: 'pending', item_count: 2, has_uncertain: false }],
    detail: [{ submission_id: 1, merchant_id: 'a', status: 'pending', item_count: 0, items: [], rejected: [], photo_path: 'x.jpg' }],
    menus: [{ name: '김치찌개', price_won: '9000', category: 'meal' }],
  }, async base => {
    const list = await (await fetch(`${base}/submissions`)).json();
    assert.equal(list.items[0].submission_id, 1);
    assert.equal((await fetch(`${base}/submissions?status=bogus`)).status, 400);
    assert.equal((await fetch(`${base}/submissions/abc`)).status, 400);
    const detail = await (await fetch(`${base}/submissions/1`)).json();
    assert.equal(detail.has_photo, true);
    assert.deepEqual(detail.current_menus, [{ name: '김치찌개', price_won: 9000, category: 'meal' }]);
    assert.equal('photo_path' in detail, false, '서버 파일 이름은 밖으로 내보내지 않는다');
  });
  await withServer({ detail: [] }, async base => {
    assert.equal((await fetch(`${base}/submissions/5`)).status, 404);
  });
});

test('사진: 형식에 맞는 헤더로 내려주고, 없으면 404, 경로 조작 이름은 막는다', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'admin-photo-'));
  process.env.MENU_PHOTO_DIR = dir;
  try {
    await fs.writeFile(path.join(dir, 'ok.png'), Buffer.from([137, 80, 78, 71]));
    await withServer({ photo: [{ photo_path: 'ok.png' }] }, async base => {
      const res = await fetch(`${base}/submissions/1/photo`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'image/png');
      assert.equal(res.headers.get('cache-control'), 'no-store');
    });
    await withServer({ photo: [{ photo_path: '../../etc/passwd' }] }, async base => {
      assert.equal((await fetch(`${base}/submissions/1/photo`)).status, 404);
    });
    await withServer({ photo: [{ photo_path: null }] }, async base => {
      assert.equal((await fetch(`${base}/submissions/1/photo`)).status, 404);
    });
    await withServer({ photo: [{ photo_path: 'gone.jpg' }] }, async base => {
      assert.equal((await fetch(`${base}/submissions/1/photo`)).status, 404);
    });
  } finally {
    delete process.env.MENU_PHOTO_DIR;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('사진 여러 장: 번호로 골라 보고, 범위를 벗어나거나 숫자가 아니면 400, 없는 장은 404', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'admin-photos-'));
  process.env.MENU_PHOTO_DIR = dir;
  try {
    await fs.writeFile(path.join(dir, 'p1.png'), Buffer.from([137, 80, 78, 71]));
    await fs.writeFile(path.join(dir, 'p2.jpg'), Buffer.from([0xff, 0xd8, 0xff]));
    await withServer({ photo: [{ photo_path: 'p1.png', photo_paths: ['p1.png', 'p2.jpg'] }] }, async base => {
      const first = await fetch(`${base}/submissions/1/photos/0`);
      assert.equal(first.headers.get('content-type'), 'image/png');
      const second = await fetch(`${base}/submissions/1/photos/1`);
      assert.equal(second.status, 200);
      assert.equal(second.headers.get('content-type'), 'image/jpeg');
      assert.equal((await fetch(`${base}/submissions/1/photo`)).headers.get('content-type'), 'image/png'); // 예전 주소 = 첫 장
      assert.equal((await fetch(`${base}/submissions/1/photos/2`)).status, 404);
      for (const bad of ['5', '9', '-1', 'a', '01', '1.5']) {
        assert.equal((await fetch(`${base}/submissions/1/photos/${bad}`)).status, 400, bad);
      }
    });
  } finally {
    delete process.env.MENU_PHOTO_DIR;
    await fs.rm(dir, { recursive: true, force: true });
  }
});
