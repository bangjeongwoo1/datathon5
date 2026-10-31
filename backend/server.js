
import express from "express";
import multer from "multer";
import cors from "cors";
import dotenv from "dotenv";
import Groq from "groq-sdk";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

if (!process.env.GROQ_API_KEY) {
  console.error("GROQ_API_KEY가 설정되지 않았습니다.");
  process.exit(1);
}

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  process.env.FRONTEND_URL?.replace(/\/+$/, ""),
].filter(Boolean);

app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

// 음성 파일은 메모리에 임시 보관
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

// 서버 작동 확인
app.get("/health", (req, res) => {
  res.json({ message: "STT 서버 정상 작동" });
});

// 음성 파일을 텍스트로 변환
app.post("/api/stt", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: "음성 파일이 없습니다.",
      });
    }

    const allowedTypes = {
      "audio/webm": "webm",
      "audio/ogg": "ogg",
      "audio/wav": "wav",
      "audio/x-wav": "wav",
      "audio/mpeg": "mp3",
      "audio/mp4": "mp4",
    };

    const mimeType = req.file.mimetype.split(";")[0];
    const extension = allowedTypes[mimeType];

    if (!extension) {
      return res.status(400).json({
        error: "지원하지 않는 음성 형식입니다.",
      });
    }

    const audioFile = new File(
      [req.file.buffer],
      `recording.${extension}`,
      { type: mimeType }
    );

    const result = await groq.audio.transcriptions.create({
      file: audioFile,
      model: "whisper-large-v3-turbo",
      language: "ko",
      response_format: "json",
    });

    res.json({ text: result.text });
  } catch (error) {
    console.error("STT 오류:", error.message);

    res.status(500).json({
      error: "음성 인식에 실패했습니다.",
    });
  }
});

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    return res.status(400).json({
      error: "음성 파일 업로드 오류: " + error.message,
    });
  }
  next(error);
});

function validCoordinates(lat, lng) {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 &&
    lng >= -180 && lng <= 180
  );
}

// 후보를 줄이기 위한 직선거리.
// 실제 안내 거리로는 사용하지 않음.
function straightDistance(a, b, c, d) {
  const rad = n => n * Math.PI / 180;
  const dLat = rad(c - a);
  const dLng = rad(d - b);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a)) * Math.cos(rad(c)) *
    Math.sin(dLng / 2) ** 2;

  return 6371000 * 2 *
    Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

app.post('/api/walking-nearest', async (req, res) => {
  if (!process.env.TMAP_APP_KEY) {
    return res.status(503).json({
      error: '백엔드에 TMAP_APP_KEY를 설정해 주세요.',
    });
  }

  const { lat, lng, stores } = req.body;

  if (
    !validCoordinates(lat, lng) ||
    !Array.isArray(stores) ||
    stores.length > 5000
  ) {
    return res.status(400).json({
      error: '위치 또는 가맹점 정보가 올바르지 않습니다.',
    });
  }

  const candidates = stores
    .filter(s =>
      s &&
      Number.isInteger(s.id) &&
      typeof s.name === 'string' &&
      typeof s.address === 'string' &&
      s.coordinates &&
      validCoordinates(s.coordinates.lat, s.coordinates.lng)
    )
    .sort((a, b) =>
      straightDistance(
        lat, lng, a.coordinates.lat, a.coordinates.lng
      ) -
      straightDistance(
        lat, lng, b.coordinates.lat, b.coordinates.lng
      )
    )
    .slice(0, 16);

  if (candidates.length === 0) {
    return res.status(404).json({
      error: '위치 좌표가 있는 가맹점이 없습니다.',
    });
  }

  async function getWalkingRoute(store) {
    try {
      const response = await fetch(
        'https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1',
        {
          method: 'POST',
          headers: {
            appKey: process.env.TMAP_APP_KEY,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            startX: lng,
            startY: lat,
            endX: store.coordinates.lng,
            endY: store.coordinates.lat,
            startName: encodeURIComponent('현재 위치'),
            endName: encodeURIComponent(store.name),
            reqCoordType: 'WGS84GEO',
            resCoordType: 'WGS84GEO',
            searchOption: '10',
          }),
          signal: AbortSignal.timeout(12000),
        }
      );

    if (!response.ok) {
  const errorMessage = await response.text();

  console.error('TMAP 응답 상태:', response.status);
  console.error('TMAP 상세 오류:', errorMessage);

  return null;
}

      const data = await response.json();

      // 보행자 경로의 출발 지점에 총 이동거리가 들어 있음
      const startPoint = data.features?.find(
        f => f.properties?.pointType === 'SP'
      );

      const meters = Number(
        startPoint?.properties?.totalDistance
      );

      if (!Number.isFinite(meters) || meters < 0) {
        return null;
      }

      return {
        id: store.id,
        name: store.name,
        address: store.address,
        meters: Math.round(meters),
      };
    } catch (error) {
      console.error('도보 경로 조회 실패:', error.message);
      return null;
    }
  }

  const routes = [];

  // 한 번에 너무 많은 API 요청을 보내지 않도록 3개씩 조회
  for (let i = 0; i < candidates.length; i += 3) {
    const batch = candidates.slice(i, i + 3);
    const results = await Promise.all(
      batch.map(getWalkingRoute)
    );

    routes.push(...results.filter(r => r !== null));
  }

  if (routes.length === 0) {
    return res.status(502).json({
      error: '도보 경로를 확인하지 못했습니다. TMAP 키와 경로 조회 가능 여부를 확인해 주세요.',
    });
  }

  routes.sort((a, b) => a.meters - b.meters);

  res.json({
    nearest: routes[0],
    total: stores.length,
    compared: routes.length,
    attempted: candidates.length,
  });
});


app.listen(PORT, () => {
  console.log(`STT 서버 실행: http://localhost:${PORT}`);
});
