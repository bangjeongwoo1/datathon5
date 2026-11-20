// 로그인한 사용자 확인 (Supabase Auth).
// 프론트가 보낸 로그인 토큰(Authorization: Bearer ...)을 서버가 Supabase 에 직접 물어서 확인한다.
// 별도 비밀 키는 필요 없고, Supabase 주소(SUPABASE_URL)와 공개 키(SUPABASE_ANON_KEY)만 쓴다.
//
// 약속(팀원과 맞춘 것): 확인이 끝나면 req.user = { id, email, name, isAdmin }
//   requireAuth  : 로그인하지 않았으면 401
//   requireAdmin : 로그인했지만 관리자가 아니면 403
//   attachUser   : 로그인했으면 req.user 를 채우고, 아니어도 막지 않는다(선택적 로그인)
// 관리자는 .env 의 ADMIN_EMAILS(쉼표로 구분)에 있는 이메일이다. 목록이 비어 있으면 아무도 관리자가 아니다.

const CACHE_TTL_MS = 60_000; // 같은 토큰을 매번 Supabase 에 묻지 않도록 잠깐 기억한다.
const CACHE_MAX = 500;
const REQUEST_TIMEOUT_MS = 8000;
const MAX_TOKEN_LENGTH = 4096;

const cache = new Map(); // 토큰 -> { user, expires }

export class AuthUnavailableError extends Error {}

export function clearAuthCache() {
  cache.clear();
}

export function authConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
}

/** ADMIN_EMAILS 를 소문자 이메일 집합으로 읽는다. */
export function adminEmails() {
  return new Set(
    String(process.env.ADMIN_EMAILS ?? '')
      .split(',')
      .map(email => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

function extractToken(req) {
  const header = req.headers?.authorization;
  if (typeof header !== 'string') return null;
  const match = header.match(/^Bearer\s+(\S+)$/i);
  if (!match || match[1].length > MAX_TOKEN_LENGTH) return null;
  return match[1];
}

/**
 * 토큰이 유효하면 { id, email, name, isAdmin }, 유효하지 않으면 null.
 * Supabase 에 연결하지 못하거나 서버 오류면 AuthUnavailableError 를 던진다.
 */
export async function verifyToken(token, fetchImpl = fetch) {
  const cached = cache.get(token);
  if (cached && cached.expires > Date.now()) return cached.user;

  const baseUrl = String(process.env.SUPABASE_URL).replace(/\/+$/, '');
  let response;
  try {
    response = await fetchImpl(`${baseUrl}/auth/v1/user`, {
      headers: {
        apikey: process.env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new AuthUnavailableError('로그인 확인 서버에 연결하지 못했습니다.');
  }

  if (response.status === 401 || response.status === 403) return null; // 만료되었거나 잘못된 토큰
  if (!response.ok) throw new AuthUnavailableError(`로그인 확인 서버 오류(${response.status})`);

  const data = await response.json();
  if (!data?.id) return null;

  const email = typeof data.email === 'string' ? data.email.trim() : '';
  // 이메일 인증이 끝난 계정만 관리자로 인정한다. (남의 이메일로 가입만 해 두는 경우를 막는다.)
  const confirmed = Boolean(data.email_confirmed_at || data.confirmed_at);
  const user = {
    id: data.id,
    email,
    name: data.user_metadata?.full_name || data.user_metadata?.name || email || '',
    isAdmin: Boolean(email) && confirmed && adminEmails().has(email.toLowerCase()),
  };

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(token, { user, expires: Date.now() + CACHE_TTL_MS });
  return user;
}

function notConfigured(res) {
  return res.status(503).json({
    error: '로그인 확인 설정이 없습니다. 서버 .env 에 SUPABASE_URL 과 SUPABASE_ANON_KEY 를 넣어 주세요.',
  });
}

// 토큰을 확인해 req.user 를 채운다. 실패 이유를 res 에 이미 응답했으면 false.
async function authenticate(req, res) {
  if (!authConfigured()) {
    notConfigured(res);
    return false;
  }

  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: '로그인이 필요합니다.' });
    return false;
  }

  try {
    const user = await verifyToken(token);
    if (!user) {
      res.status(401).json({ error: '로그인이 만료되었거나 올바르지 않습니다. 다시 로그인해 주세요.' });
      return false;
    }
    req.user = user;
    return true;
  } catch (error) {
    console.error('로그인 확인 오류:', error.message);
    res.status(503).json({ error: '로그인 확인 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
    return false;
  }
}

export async function requireAuth(req, res, next) {
  if (await authenticate(req, res)) next();
}

export async function requireAdmin(req, res, next) {
  if (!(await authenticate(req, res))) return;
  if (!req.user.isAdmin) {
    return res.status(403).json({ error: '관리자만 사용할 수 있습니다.' });
  }
  next();
}

/** 로그인했으면 req.user 를 채우고, 로그인하지 않았거나 확인에 실패해도 요청을 막지 않는다. */
export async function attachUser(req, res, next) {
  const token = extractToken(req);
  if (token && authConfigured()) {
    try {
      const user = await verifyToken(token);
      if (user) req.user = user;
    } catch (error) {
      console.error('로그인 확인 오류(무시하고 진행):', error.message);
    }
  }
  next();
}
