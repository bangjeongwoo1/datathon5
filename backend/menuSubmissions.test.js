import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  deletePhoto,
  findMerchant,
  isValidMerchantId,
  merchantExists,
  merchantSourceTable,
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
      if (/FROM public\.\w+\s+WHERE merchant_id/.test(sql)) {
        // staging 번호('1')와 옛 번호('CC-000001') 중 하나만 있는 가게 목록인 것처럼 흉내 낸다.
        const known = /merchant_crawl_staging/.test(sql) ? '1' : 'CC-000001';
        return {
          rows: params[0] === known ? [{ name: '시험식당', address: '강원 춘천시 중앙로 33' }] : [],
        };
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

test('가게 확인은 기본으로 지금 지도가 쓰는 merchants 의 번호로 한다', async () => {
  delete process.env.MERCHANT_SOURCE_TABLE;
  const db = fakeDb();

  assert.equal(merchantSourceTable(), 'merchants');
  assert.equal(await merchantExists(db, 'CC-000001'), true);
  assert.equal(await merchantExists(db, 'NOPE'), false);
  assert.equal(await merchantExists(db, '1'), false); // staging 번호는 merchants 에 없다
  assert.match(db.calls[0].sql, /FROM public\.merchants\s/);
});

test('MERCHANT_SOURCE_TABLE=merchant_crawl_staging 한 줄로 가게 목록을 staging 으로 바꾼다', async () => {
  process.env.MERCHANT_SOURCE_TABLE = 'merchant_crawl_staging';
  try {
    const db = fakeDb();
    assert.equal(merchantSourceTable(), 'merchant_crawl_staging');
    assert.equal(await merchantExists(db, '1'), true);
    assert.equal(await merchantExists(db, 'CC-000001'), false);
    // staging 은 이름·주소 칸 이름이 달라서 별칭(AS)으로 같은 모양으로 꺼낸다.
    assert.match(db.calls[0].sql, /"mrhstNm" AS name/);
    assert.match(db.calls[0].sql, /"rdnmadr" AS address/);
    assert.match(db.calls[0].sql, /FROM public\.merchant_crawl_staging\s/);
  } finally {
    delete process.env.MERCHANT_SOURCE_TABLE;
  }
});

test('가게를 찾으면 이름·주소를 돌려주고, 없으면 null', async () => {
  delete process.env.MERCHANT_SOURCE_TABLE;
  const db = fakeDb();
  assert.deepEqual(await findMerchant(db, 'CC-000001'), {
    name: '시험식당',
    address: '강원 춘천시 중앙로 33',
  });
  assert.equal(await findMerchant(db, 'NOPE'), null);
});

test('허용하지 않은 테이블 이름은 거절한다 (SQL에 들어가는 값이므로)', async () => {
  process.env.MERCHANT_SOURCE_TABLE = 'merchants; DROP TABLE menus';
  try {
    assert.throws(() => merchantSourceTable(), /MERCHANT_SOURCE_TABLE/);
    await assert.rejects(merchantExists(fakeDb(), '1'), /MERCHANT_SOURCE_TABLE/);
  } finally {
    delete process.env.MERCHANT_SOURCE_TABLE;
  }
});

test('가게 목록 테이블이 DB에 없으면 해결 방법이 담긴 오류를 낸다', async () => {
  delete process.env.MERCHANT_SOURCE_TABLE;
  const db = {
    query: async () => {
      const error = new Error('relation "public.merchant_crawl_staging" does not exist');
      error.code = '42P01';
      throw error;
    },
  };
  await assert.rejects(findMerchant(db, '1'), /public\.merchants.*MERCHANT_SOURCE_TABLE/s);
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
      merchant: { name: '시험식당', address: '강원 춘천시 중앙로 33' },
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
    // 제출 당시의 가게 이름·주소가 함께 저장된다 (나중에 번호 체계가 바뀔 때 다시 연결하는 단서)
    assert.equal(params[8], '시험식당');
    assert.equal(params[9], '강원 춘천시 중앙로 33');

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
    // 가게 정보를 넘기지 않아도 저장은 되고, 이름·주소는 비어 있게(NULL) 저장된다.
    assert.equal(params[8], null);
    assert.equal(params[9], null);
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
