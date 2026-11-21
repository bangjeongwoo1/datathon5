// Local-only experiment: edited AI/TTS/TMAP modules + existing read-only merchant/STT API.
// Does not connect to or write a local DB, deploy code, or modify production settings.
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { createServer as createHttpServer } from 'node:http';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backend = createRequire(path.join(root, 'backend/package.json'));
const frontend = createRequire(path.join(root, 'frontend/package.json'));
const dotenv = backend('dotenv');
dotenv.config({ path: path.join(root, 'backend/.env'), quiet: true });
dotenv.config({ path: path.join(root, 'frontend/.env.local'), quiet: true });
if (!process.env.GROQ_API_KEY) throw new Error('backend/.env의 GROQ_API_KEY가 필요합니다.');
if (!process.env.VITE_SUPABASE_URL || !process.env.VITE_SUPABASE_ANON_KEY) throw new Error('frontend/.env.local의 기존 Supabase 공개 설정이 필요합니다.');
const apiPort = 3091, webPort = 5173;
const origin = `http://localhost:${webPort}`;
process.env.VITE_API_BASE_URL = `http://localhost:${apiPort}`;
const express = backend('express');
const cors = backend('cors');
const Groq = backend('groq-sdk').default;
const { registerGuideAi } = await import('../backend/guideAi.js');
const { registerGuideSpeech } = await import('../backend/guideSpeech.js');
const { registerWalkingRoute } = await import('../backend/walkingRoute.js');
const { createServer } = await import(pathToFileURL(frontend.resolve('vite')).href);
const app = express();
app.use(cors({ origin }));
app.use(express.json({ limit: '1mb' }));
registerGuideAi(app, new Groq({ apiKey: process.env.GROQ_API_KEY }));
registerGuideSpeech(app);
registerWalkingRoute(app);
app.get('/health', (_req, res) => res.json({ mode: 'local-voice-experiment', ai: 'local-module', speech: 'local-module', route: 'local-module', merchants: 'existing-read-api', stt: 'existing-api' }));
const upstream = new URL(process.env.LOCAL_DATA_API_BASE_URL || 'https://eatda.onrender.com');
if (upstream.protocol !== 'https:') throw new Error('LOCAL_DATA_API_BASE_URL에는 HTTPS API 주소를 사용하세요.');
app.use('/api', express.raw({ type: 'multipart/form-data', limit: '20mb' }), async (req, res) => {
  if (req.method !== 'GET' && !(req.method === 'POST' && req.path === '/stt')) return res.sendStatus(404);
  try {
    const response = await fetch(new URL(req.originalUrl, upstream), {
      method: req.method,
      headers: req.method === 'POST' ? { 'Content-Type': req.get('Content-Type') } : {},
      body: req.method === 'POST' ? req.body : undefined,
      signal: AbortSignal.timeout(25000),
    });
    res.status(response.status).type(response.headers.get('content-type') || 'application/json');
    res.send(Buffer.from(await response.arrayBuffer()));
  } catch { res.status(502).json({ error: '기존 데이터/음성 서버 연결에 실패했습니다.' }); }
});
const server = app.listen(apiPort, 'localhost');
await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
const vite = await createServer({ root: path.join(root, 'frontend'), server: { host: 'localhost', port: webPort, strictPort: true } });
await vite.listen();
const alias = createHttpServer((req, res) => { res.writeHead(307, { Location: origin + (req.url || '/') }); res.end(); });
alias.on('error', () => console.warn('Optional 5174 redirect unavailable; use the 5173 URL.'));
alias.listen(5174, 'localhost');
console.log(`Local voice experiment ready: ${origin}/finder.html`);
console.log('AI/TTS/route: edited local modules. Merchant/STT: existing API. No production deployment or DB writes.');
async function stop() { await vite.close(); alias.close(); server.close(); process.exit(0); }
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
