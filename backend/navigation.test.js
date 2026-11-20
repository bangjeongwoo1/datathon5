import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { registerGuideSpeech } from './guideSpeech.js';
import { getWalkingRoute, registerWalkingRoute } from './walkingRoute.js';

async function withApi(register, run) {
  const app = express(); app.use(express.json()); register(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const send = globalThis.fetch;
  try {
    await run((path, body) => send(`http://127.0.0.1:${server.address().port}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }));
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
const store = { id: 1, name: '테스트 가맹점', address: '테스트 주소', coordinates: { lat: 37.88, lng: 127.73 } };
const fixture = { features: [
  { geometry: { type: 'Point', coordinates: [127.72, 37.87] }, properties: { pointType: 'SP', totalDistance: 120 } },
  { geometry: { type: 'LineString', coordinates: [[127.72, 37.87], [127.73, 37.88]] }, properties: { distance: 120 } },
  { geometry: { type: 'Point', coordinates: [127.725, 37.875] }, properties: { turnType: 12, description: '왼쪽 방향으로 이동' } },
] };

test('TMAP geometry and turns map to the frontend contract; malformed upstream is rejected', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      assert.match(url, /routes\/pedestrian/);
      assert.equal(JSON.parse(options.body).endX, store.coordinates.lng);
      assert.ok(options.signal instanceof AbortSignal);
      return { ok: true, json: async () => fixture };
    };
    const route = await getWalkingRoute(37.87, 127.72, store);
    assert.equal(route.meters, 120);
    assert.deepEqual(route.segments[0].path[1], store.coordinates);
    assert.equal(route.steps[0].instruction, '왼쪽 방향으로 이동');
    for (const data of [{}, { features: [] }, { features: [{ properties: { pointType: 'SP', totalDistance: null } }] }]) {
      globalThis.fetch = async () => ({ ok: true, json: async () => data });
      assert.equal(await getWalkingRoute(37.87, 127.72, store), null);
    }
  } finally { globalThis.fetch = original; }
});

test('route API distinguishes missing credentials, invalid input and upstream failure', async () => {
  const key = process.env.TMAP_APP_KEY, original = globalThis.fetch;
  try {
    await withApi(registerWalkingRoute, async post => {
      delete process.env.TMAP_APP_KEY;
      assert.equal((await post('/api/walking-route', {})).status, 503);
      process.env.TMAP_APP_KEY = 'test-only';
      assert.equal((await post('/api/walking-route', { lat: 91, lng: 127, store })).status, 400);
      globalThis.fetch = async () => { throw new Error('simulated timeout'); };
      assert.equal((await post('/api/walking-route', { lat: 37.87, lng: 127.72, store })).status, 502);
      globalThis.fetch = async () => ({ ok: true, json: async () => fixture });
      const response = await post('/api/walking-route', { lat: 37.87, lng: 127.72, store });
      assert.equal(response.status, 200);
      assert.deepEqual(Object.keys(await response.json()).sort(), ['meters', 'segments', 'steps']);
    });
  } finally {
    globalThis.fetch = original;
    if (key === undefined) delete process.env.TMAP_APP_KEY; else process.env.TMAP_APP_KEY = key;
  }
});

test('TTS validates text, caches audio and enforces quota without another voice fallback', async () => {
  let calls = 0;
  await withApi(app => registerGuideSpeech(app, { enabled: true, dailyCharacters: 5, synthesize: async () => { calls++; return Buffer.from('test audio'); } }), async post => {
    assert.equal((await post('/api/guide-speech', { text: '' })).status, 400);
    assert.equal((await post('/api/guide-speech', { text: 'a'.repeat(401) })).status, 400);
    for (let i = 0; i < 2; i++) {
      const response = await post('/api/guide-speech', { text: 'hello' });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /audio\/mpeg/);
      assert.equal(await response.text(), 'test audio');
    }
    assert.equal(calls, 1);
    assert.equal((await post('/api/guide-speech', { text: 'next' })).status, 429);
  });
  await withApi(app => registerGuideSpeech(app, { enabled: false }), async post => {
    assert.equal((await post('/api/guide-speech', { text: 'hello' })).status, 503);
  });
  await withApi(app => registerGuideSpeech(app, { enabled: true, synthesize: async () => { throw new Error('provider error'); } }), async post => {
    assert.equal((await post('/api/guide-speech', { text: 'hello' })).status, 502);
  });
});
