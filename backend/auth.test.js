import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AuthUnavailableError,
  adminEmails,
  attachUser,
  clearAuthCache,
  requireAdmin,
  requireAuth,
  verifyToken,
} from './auth.js';

function setEnv({ url = 'https://example.supabase.co/', key = 'anon-key', admins = 'boss@example.com' } = {}) {
  process.env.SUPABASE_URL = url;
  process.env.SUPABASE_ANON_KEY = key;
  process.env.ADMIN_EMAILS = admins;
  clearAuthCache();
}

function resetEnv() {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.ADMIN_EMAILS;
  clearAuthCache();
}

const supabaseUser = (overrides = {}) => ({
  id: 'user-1',
  email: 'boss@example.com',
  email_confirmed_at: '2026-11-01T00:00:00Z',
  user_metadata: { full_name: '관리자' },
  ...overrides,
});

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status });

// 테스트용 가짜 요청·응답
function fakeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}
const fakeReq = token => ({ headers: token ? { authorization: `Bearer ${token}` } : {} });

async function runMiddleware(middleware, req) {
  const res = fakeRes();
  let nextCalled = false;
  await middleware(req, res, () => { nextCalled = true; });
  return { res, nextCalled };
}

function withFetch(handler, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return Promise.resolve(fn()).finally(() => { globalThis.fetch = original; });
}

test('ADMIN_EMAILS: 공백·대소문자·빈 값을 정리한다', () => {
  process.env.ADMIN_EMAILS = ' Boss@Example.com , ,second@example.com,, ';
  assert.deepEqual([...adminEmails()].sort(), ['boss@example.com', 'second@example.com']);
  delete process.env.ADMIN_EMAILS;
  assert.equal(adminEmails().size, 0);
});

test('유효한 토큰: 사용자 정보를 돌려주고 Supabase 에는 키와 토큰을 헤더로 보낸다', async () => {
  setEnv();
  let call;
  await withFetch(async (url, init) => { call = { url: String(url), init }; return jsonResponse(supabaseUser()); }, async () => {
    const user = await verifyToken('token-abc');
    assert.deepEqual(user, { id: 'user-1', email: 'boss@example.com', name: '관리자', isAdmin: true });
  });
  assert.equal(call.url, 'https://example.supabase.co/auth/v1/user'); // 주소 끝의 / 는 정리된다
  assert.equal(call.init.headers.apikey, 'anon-key');
  assert.equal(call.init.headers.Authorization, 'Bearer token-abc');
  assert.ok(!call.url.includes('token-abc'), '토큰을 주소에 넣지 않는다');
  resetEnv();
});

test('관리자 목록에 없는 이메일은 로그인했어도 관리자가 아니다', async () => {
  setEnv({ admins: 'someone-else@example.com' });
  await withFetch(async () => jsonResponse(supabaseUser()), async () => {
    assert.equal((await verifyToken('t1')).isAdmin, false);
  });
  resetEnv();
});

test('ADMIN_EMAILS 가 비어 있으면 아무도 관리자가 아니다(기본은 잠금)', async () => {
  setEnv({ admins: '' });
  await withFetch(async () => jsonResponse(supabaseUser()), async () => {
    assert.equal((await verifyToken('t1')).isAdmin, false);
  });
  resetEnv();
});

test('이메일 인증이 안 된 계정은 목록에 있는 이메일이어도 관리자가 아니다', async () => {
  setEnv();
  await withFetch(async () => jsonResponse(supabaseUser({ email_confirmed_at: null })), async () => {
    assert.equal((await verifyToken('t1')).isAdmin, false);
  });
  resetEnv();
});

test('만료되었거나 잘못된 토큰(401)은 null, 서버 오류·연결 실패는 AuthUnavailableError', async () => {
  setEnv();
  await withFetch(async () => jsonResponse({ msg: 'invalid' }, 401), async () => {
    assert.equal(await verifyToken('bad'), null);
  });
  await withFetch(async () => jsonResponse({}, 500), async () => {
    await assert.rejects(verifyToken('x'), AuthUnavailableError);
  });
  await withFetch(async () => { throw new TypeError('fetch failed'); }, async () => {
    await assert.rejects(verifyToken('y'), AuthUnavailableError);
  });
  resetEnv();
});

test('같은 토큰은 잠깐 기억해서 Supabase 를 다시 부르지 않는다', async () => {
  setEnv();
  let calls = 0;
  await withFetch(async () => { calls += 1; return jsonResponse(supabaseUser()); }, async () => {
    await verifyToken('same');
    await verifyToken('same');
    await verifyToken('other');
  });
  assert.equal(calls, 2);
  resetEnv();
});

test('requireAuth: 토큰이 없으면 401, 설정이 없으면 503, 유효하면 통과하고 req.user 를 채운다', async () => {
  resetEnv();
  let r = await runMiddleware(requireAuth, fakeReq('t'));
  assert.equal(r.res.statusCode, 503); // 설정 없음
  assert.equal(r.nextCalled, false);

  setEnv();
  r = await runMiddleware(requireAuth, fakeReq(null));
  assert.equal(r.res.statusCode, 401);
  assert.equal(r.nextCalled, false);

  await withFetch(async () => jsonResponse(supabaseUser()), async () => {
    const req = fakeReq('good');
    const ok = await runMiddleware(requireAuth, req);
    assert.equal(ok.nextCalled, true);
    assert.equal(req.user.email, 'boss@example.com');
  });

  await withFetch(async () => jsonResponse({}, 401), async () => {
    const bad = await runMiddleware(requireAuth, fakeReq('expired'));
    assert.equal(bad.res.statusCode, 401);
    assert.equal(bad.nextCalled, false);
  });

  await withFetch(async () => { throw new Error('down'); }, async () => {
    const down = await runMiddleware(requireAuth, fakeReq('whatever'));
    assert.equal(down.res.statusCode, 503);
    assert.equal(down.nextCalled, false);
  });
  resetEnv();
});

test('Authorization 헤더 형식이 이상하면 토큰으로 보지 않는다', async () => {
  setEnv();
  for (const header of ['Basic abc', 'Bearer', 'Bearer a b', 'abc', 'Bearer ' + 'x'.repeat(5000)]) {
    const r = await runMiddleware(requireAuth, { headers: { authorization: header } });
    assert.equal(r.res.statusCode, 401, header.slice(0, 20));
    assert.equal(r.nextCalled, false);
  }
  resetEnv();
});

test('requireAdmin: 관리자는 통과, 일반 로그인 사용자는 403, 비로그인은 401', async () => {
  setEnv({ admins: 'boss@example.com' });

  await withFetch(async () => jsonResponse(supabaseUser()), async () => {
    const r = await runMiddleware(requireAdmin, fakeReq('admin-token'));
    assert.equal(r.nextCalled, true);
  });

  await withFetch(async () => jsonResponse(supabaseUser({ id: 'user-2', email: 'student@example.com' })), async () => {
    const r = await runMiddleware(requireAdmin, fakeReq('student-token'));
    assert.equal(r.res.statusCode, 403);
    assert.equal(r.nextCalled, false);
  });

  const anonymous = await runMiddleware(requireAdmin, fakeReq(null));
  assert.equal(anonymous.res.statusCode, 401);
  assert.equal(anonymous.nextCalled, false);
  resetEnv();
});

test('attachUser: 로그인했으면 req.user 를 채우고, 아니어도 요청은 막지 않는다', async () => {
  setEnv();

  await withFetch(async () => jsonResponse(supabaseUser()), async () => {
    const req = fakeReq('good');
    const r = await runMiddleware(attachUser, req);
    assert.equal(r.nextCalled, true);
    assert.equal(req.user.id, 'user-1');
  });

  const noToken = fakeReq(null);
  const r1 = await runMiddleware(attachUser, noToken);
  assert.equal(r1.nextCalled, true);
  assert.equal(noToken.user, undefined);

  await withFetch(async () => jsonResponse({}, 401), async () => {
    const bad = fakeReq('expired');
    const r2 = await runMiddleware(attachUser, bad);
    assert.equal(r2.nextCalled, true);
    assert.equal(bad.user, undefined);
  });

  await withFetch(async () => { throw new Error('down'); }, async () => {
    const down = fakeReq('whatever');
    const r3 = await runMiddleware(attachUser, down);
    assert.equal(r3.nextCalled, true); // 로그인 서버가 죽어도 제보는 막지 않는다
    assert.equal(down.user, undefined);
  });
  resetEnv();
});
