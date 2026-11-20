import { pool } from "./db.js";
import express from "express";
import multer from "multer";
import cors from "cors";
import dotenv from "dotenv";
import Groq from "groq-sdk";
import {
  extractMenuFromImage,
  geminiConfigured,
  MenuOcrError,
} from "./menuOcr.js";

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
  "http://127.0.0.1:5173",
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


app.get("/api/merchants", async (req, res) => {
  try {
    const region = String(req.query.region || "").trim();
    const search = String(req.query.search || "").trim();

    const limit = Math.min(
      1000,
      Math.max(1, Number.parseInt(req.query.limit, 10) || 100)
    );

    const offset = Math.max(
      0,
      Number.parseInt(req.query.offset, 10) || 0
    );

    const conditions = [];
    const params = [];

    if (region) {
      params.push(region);
      conditions.push(`region = $${params.length}`);
    }

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`name ILIKE $${params.length}`);
    }

    const where = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM public.merchants ${where}`,
      params
    );

    const dataResult = await pool.query(
  `SELECT
      m.*,
      n.naver_cuisine,
      n.naver_classification,
      n.weekday_open,
      n.weekday_close,
      n.saturday_open,
      n.saturday_close,
      n.sunday_open,
      n.sunday_close,
      n.address_check,
      n.match_status
   FROM public.merchants AS m
   LEFT JOIN public.merchant_naver_info AS n
     ON m.merchant_id = n.merchant_id
   ${where}
   ORDER BY m.merchant_id
   LIMIT $${params.length + 1}
   OFFSET $${params.length + 2}`,
  [...params, limit, offset]
);

    res.json({
      total: countResult.rows[0].total,
      limit,
      offset,
      merchants: dataResult.rows,
    });
  } catch (error) {
    console.error("가맹점 조회 오류:", error.message);
    res.status(500).json({
      error: "가맹점 데이터를 조회하지 못했습니다.",
    });
  }
});


// ---- 메뉴판 사진 OCR (Gemini) ----

const menuImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
}).single("image");

// 파일 앞부분(매직 바이트)으로 실제 이미지 형식을 확인한다.
function sniffImageType(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

// 비용 보호용 간단한 호출 제한(서버 재시작 시 초기화되는 메모리 방식)
const OCR_LIMIT_PER_IP_PER_HOUR = 10;
const OCR_LIMIT_PER_DAY = 200;
const ocrHits = new Map(); // ip -> 최근 1시간 요청 시각 목록
let ocrDay = { date: "", count: 0 };

function checkOcrLimit(ip) {
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);

  if (ocrDay.date !== today) ocrDay = { date: today, count: 0 };
  if (ocrDay.count >= OCR_LIMIT_PER_DAY) {
    return "오늘 처리 가능한 건수를 초과했습니다. 내일 다시 시도해 주세요.";
  }

  const recent = (ocrHits.get(ip) || []).filter(t => now - t < 3600_000);
  if (recent.length >= OCR_LIMIT_PER_IP_PER_HOUR) {
    return "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.";
  }

  recent.push(now);
  ocrHits.set(ip, recent);
  ocrDay.count += 1;
  return null;
}

app.post("/api/menu-ocr", (req, res) => {
  if (!geminiConfigured()) {
    return res.status(503).json({
      error: "백엔드에 GEMINI_API_KEY를 설정해 주세요.",
    });
  }

  menuImageUpload(req, res, async uploadError => {
    if (uploadError) {
      const tooLarge = uploadError.code === "LIMIT_FILE_SIZE";
      return res.status(400).json({
        error: tooLarge
          ? "사진 용량은 5MB 이하여야 합니다."
          : "사진 업로드 중 오류가 발생했습니다.",
      });
    }

    if (!req.file) {
      return res.status(400).json({ error: "메뉴판 사진이 없습니다." });
    }

    const mimeType = sniffImageType(req.file.buffer);
    if (!mimeType) {
      return res.status(400).json({
        error: "JPG, PNG, WEBP 형식의 사진만 올릴 수 있습니다.",
      });
    }

    const limited = checkOcrLimit(req.ip);
    if (limited) {
      return res.status(429).json({ error: limited });
    }

    try {
      const result = await extractMenuFromImage(req.file.buffer, mimeType);
      res.json(result);
    } catch (error) {
      if (error instanceof MenuOcrError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error("메뉴 OCR 오류:", error.message);
      res.status(500).json({ error: "메뉴판 분석에 실패했습니다." });
    }
  });
});

app.listen(PORT, () => {
  console.log(`STT 서버 실행: http://localhost:${PORT}`);
});
