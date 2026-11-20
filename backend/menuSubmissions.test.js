import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  deletePhoto,
  isValidMerchantId,
  merchantExists,
  savePhoto,
  submitMenuPhoto,
} from './menuSubmissions.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

async function withTempPhotoDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'menu-photos-'));
  process.env.MENU_PHOTO_DIR = dir;
  try {
    await fn(dir);
  } finally {
    delete process.env.MENU_PHOTO_DIR;
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function fakeDb({ failInsert = false } = {}) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (/FROM public\.merchants/.test(sql)) {
        return { rows: params[0] === 'CC-000001' ? [{ '?column?': 1 }] : [] };
      }
      if (failInsert) throw new Error('db down');
      return { rows: [{ submission_id: '7', status: 'pending', created_at: '2026-11-20T00:00:00Z' }] };
    },
  };
}

test('merchant_id 형식 검사: 정상 값은 통과, 경로·특수문자는 거절', () => {
  for (const ok of ['CC-000001', 'WJ-005979', '123', 'a_b-9']) {
    assert.equal(isValidMerchantId(ok), true, ok);
  }
  for (const bad of ['', '../etc', 'a b', "x';--", 'a'.repeat(41), null, undefined, 12]) {
    assert.equal(isValidMerchantId(bad), false, String(bad));
  }
});

test('가게 존재 여부를 조회한다', async () => {
  const db = fakeDb();
  assert.equal(await merchantExists(db, 'CC-000001'), true);
  assert.equal(await merchantExists(db, 'NOPE'), false);
});

test('사진은 서버가 정한 이름으로 저장되고 삭제할 수 있다', async () => {
  await withTempPhotoDir(async dir => {
    const name = await savePhoto(PNG, 'image/png');
    assert.match(name, /^[0-9a-f-]{36}\.png$/);
    assert.deepEqual(await fs.readdir(dir), [name]);

    await deletePhoto(name);
    assert.deepEqual(await fs.readdir(dir), []);

    // 없는 파일·빈 값을 지워도 오류가 아니다
    await deletePhoto(name);
    await deletePhoto(null);

    // 지원하지 않는 형식은 저장하지 않는다
    await assert.rejects(savePhoto(PNG, 'image/gif'));
  });
});

test('deletePhoto는 경로를 벗어나는 이름으로 다른 파일을 지우지 못한다', async () => {
  await withTempPhotoDir(async dir => {
    const outside = path.join(path.dirname(dir), `outside-${Date.now()}.txt`);
    await fs.writeFile(outside, 'keep');
    try {
      await deletePhoto(`../${path.basename(outside)}`);
      assert.equal(await fs.readFile(outside, 'utf8'), 'keep');
    } finally {
      await fs.rm(outside, { force: true });
    }
  });
});

test('제보 저장: 검수 대기로 넣고, 불확실 항목이 있으면 표시한다', async () => {
  await withTempPhotoDir(async dir => {
    const db = fakeDb();
    const ocr = {
      model: 'model-a',
      items: [
        { name: '김치찌개', price_won: 9000, category: 'meal', status: 'ok' },
        { name: '돈까스', price_won: 10000, category: 'meal', status: 'uncertain' },
      ],
      rejected: [{ name: '시가', reason: '가격 해석 불가' }],
    };

    const result = await submitMenuPhoto(db, {
      merchantId: 'CC-000001',
      buffer: PNG,
      mimeType: 'image/png',
      ocr,
    });

    assert.equal(result.submission_id, 7);
    assert.equal(result.status, 'pending');
    assert.equal(result.has_uncertain, true);
    assert.equal(result.items.length, 2);

    const [params] = db.calls.map(c => c.params);
    assert.equal(params[0], 'CC-000001');
    assert.equal(params[1], null); // 로그인 전: 제출자 없음
    assert.equal(params[2], null);
    assert.match(params[3], /\.png$/);
    assert.deepEqual(JSON.parse(params[4]), ocr.items);
    assert.equal(params[6], 'model-a');
    assert.equal(params[7], true);

    // 사진이 보관돼 있고 photo_path가 그 파일을 가리킨다
    assert.deepEqual(await fs.readdir(dir), [params[3]]);
  });
});

test('제보 저장: 모두 ok이면 불확실 표시가 없고, 로그인 사용자가 있으면 기록한다', async () => {
  await withTempPhotoDir(async () => {
    const db = fakeDb();
    const result = await submitMenuPhoto(db, {
      merchantId: 'CC-000001',
      buffer: PNG,
      mimeType: 'image/png',
      ocr: { model: 'm', items: [{ name: 'a', price_won: 8000, category: 'meal', status: 'ok' }], rejected: [] },
      user: { id: 'user-1', email: 'a@example.com' },
    });

    assert.equal(result.has_uncertain, false);
    const params = db.calls[0].params;
    assert.equal(params[1], 'user-1');
    assert.equal(params[2], 'a@example.com');
  });
});

test('DB 저장이 실패하면 방금 저장한 사진도 지운다', async () => {
  await withTempPhotoDir(async dir => {
    const db = fakeDb({ failInsert: true });
    await assert.rejects(
      submitMenuPhoto(db, {
        merchantId: 'CC-000001',
        buffer: PNG,
        mimeType: 'image/png',
        ocr: { model: 'm', items: [{ name: 'a', price_won: 8000, category: 'meal', status: 'ok' }], rejected: [] },
      }),
      /db down/
    );
    assert.deepEqual(await fs.readdir(dir), []);
  });
});
