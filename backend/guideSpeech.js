import { GoogleAuth } from 'google-auth-library';

const DEFAULT_VOICE = 'ko-KR-Chirp3-HD-Aoede';
const MAX_TEXT_LENGTH = 400;
const MAX_CACHE_ENTRIES = 64;
const MAX_CONCURRENT_REQUESTS = 4;
const url = 'https://texttospeech.googleapis.com/v1/text:synthesize';

function createGoogleSynthesizer(voice, quotaProject, apiKey) {
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  return async text => {
    if (apiKey) {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          input: { text },
          voice: { languageCode: 'ko-KR', name: voice },
          audioConfig: { audioEncoding: 'MP3' },
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error('Google speech request failed');
      const data = await response.json();
      if (typeof data.audioContent !== 'string' || !data.audioContent || data.audioContent.length > 1500000) {
        throw new Error('Unexpected speech data');
      }
      return Buffer.from(data.audioContent, 'base64');
    }
    const client = await auth.getClient();
    const { data } = await client.request({
      url,
      method: 'POST',
      headers: quotaProject ? { 'x-goog-user-project': quotaProject } : {},
      data: {
        input: { text },
        voice: { languageCode: 'ko-KR', name: voice },
        audioConfig: { audioEncoding: 'MP3' },
      },
      timeout: 8000,
      retry: false,
    });
    if (typeof data?.audioContent !== 'string' || !data.audioContent || data.audioContent.length > 1500000) {
      throw new Error('Unexpected speech data');
    }
    return Buffer.from(data.audioContent, 'base64');
  };
}

export function registerGuideSpeech(app, {
  enabled = process.env.GUIDE_GOOGLE_TTS_ENABLED === 'true',
  voice = process.env.GUIDE_GOOGLE_TTS_VOICE?.trim() || DEFAULT_VOICE,
  quotaProject = process.env.GOOGLE_CLOUD_QUOTA_PROJECT?.trim(),
  apiKey = process.env.GOOGLE_TTS_API_KEY?.trim(),
  dailyCharacters = Number(process.env.GUIDE_GOOGLE_TTS_DAILY_CHARS ?? 15000),
  synthesize = createGoogleSynthesizer(voice, quotaProject, apiKey),
} = {}) {
  const dailyLimit = Number.isSafeInteger(dailyCharacters)
    ? Math.min(100000, Math.max(0, dailyCharacters)) : 15000;
  const cache = new Map();
  const inFlight = new Map();
  let usageDay = '';
  let used = 0;

  app.post('/api/guide-speech', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!enabled) return res.sendStatus(503);

    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text || text.length > MAX_TEXT_LENGTH || /[\u0000-\u001f\u007f]/.test(text)) {
      return res.sendStatus(400);
    }

    let audio = cache.get(text);
    if (audio) return res.type('audio/mpeg').send(audio);

    let synthesis = inFlight.get(text);
    if (!synthesis) {
      const today = new Date().toISOString().slice(0, 10);
      if (today !== usageDay) {
        usageDay = today;
        used = 0;
      }
      if (used + text.length > dailyLimit || inFlight.size >= MAX_CONCURRENT_REQUESTS) {
        return res.sendStatus(429);
      }
      used += text.length;
      synthesis = Promise.resolve().then(() => synthesize(text));
      inFlight.set(text, synthesis);
    }

    try {
      audio = await synthesis;
      if (!Buffer.isBuffer(audio) || !audio.length) throw new Error('Empty speech data');
      cache.set(text, audio);
      if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
      return res.type('audio/mpeg').send(audio);
    } catch {
      return res.sendStatus(502);
    } finally {
      inFlight.delete(text);
    }
  });
}
