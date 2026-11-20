import { validCoordinates, getWalkingRoute, registerWalkingRoute } from "./walkingRoute.js";
import { registerGuideSpeech } from "./guideSpeech.js";
import { registerGuideAi } from "./guideAi.js";
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
import { attachUser, requireAdmin, requireAuth } from "./auth.js";
import { createAdminRouter } from "./adminRoutes.js";
import { merchantListQueries } from "./merchantList.js";
import { MAX_MENU_PHOTOS, extractMenusFromPhotos } from "./menuPhotoBatch.js";
import {
  findMerchant,
  isValidMerchantId,
  submitMenuPhoto,
} from "./menuSubmissions.js";

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
registerGuideSpeech(app);
registerGuideAi(app, groq);
registerWalkingRoute(app);

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

  const routes = [];

  // 한 번에 너무 많은 API 요청을 보내지 않도록 3개씩 조회
  for (let i = 0; i < candidates.length; i += 3) {
    const batch = candidates.slice(i, i + 3);
    const results = await Promise.all(
      batch.map(store => getWalkingRoute(lat, lng, store))
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
    nearest: { id: routes[0].id, name: routes[0].name, address: routes[0].address, meters: routes[0].meters },
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

    const { countSql, countParams, dataSql, dataParams } = merchantListQueries({
      region,
      search,
      limit,
      offset,
    });
    const countResult = await pool.query(countSql, countParams);
    const dataResult = await pool.query(dataSql, dataParams);

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

// 사진은 한 번에 최대 5장(images 필드). 예전처럼 image 필드로 한 장만 보내도 받는다.
const menuImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: MAX_MENU_PHOTOS },
}).fields([
  { name: "images", maxCount: MAX_MENU_PHOTOS },
  { name: "image", maxCount: 1 },
]);

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
// 기본은 IP당 시간당 10건, 하루 전체 200건. 데이터를 한꺼번에 넣어 볼 때처럼 잠깐 늘려야 하면
// .env 에 OCR_LIMIT_PER_IP_PER_HOUR, OCR_LIMIT_PER_DAY 를 적는다. (양의 정수가 아니면 기본값을 쓴다.)
// 이 한도가 Gemini 비용의 상한이므로, 배포 서버에서는 기본값을 유지하는 것을 권한다.
function limitFromEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
const ocrLimitPerIpPerHour = () => limitFromEnv("OCR_LIMIT_PER_IP_PER_HOUR", 10);
const ocrLimitPerDay = () => limitFromEnv("OCR_LIMIT_PER_DAY", 200);
const ocrHits = new Map(); // ip -> 최근 1시간 요청 시각 목록
let ocrDay = { date: "", count: 0 };

// 사진 한 장이 AI 호출 한 번이므로, 여러 장이면 장수만큼 센다.
function checkOcrLimit(ip, count = 1) {
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);

  if (ocrDay.date !== today) ocrDay = { date: today, count: 0 };
  if (ocrDay.count + count > ocrLimitPerDay()) {
    return "오늘 처리 가능한 건수를 초과했습니다. 내일 다시 시도해 주세요.";
  }

  const recent = (ocrHits.get(ip) || []).filter(t => now - t < 3600_000);
  if (recent.length + count > ocrLimitPerIpPerHour()) {
    return "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.";
  }

  for (let i = 0; i < count; i += 1) recent.push(now);
  ocrHits.set(ip, recent);
  ocrDay.count += count;
  return null;
}

function requireGemini(req, res, next) {
  if (!geminiConfigured()) {
    return res.status(503).json({
      error: "백엔드에 GEMINI_API_KEY를 설정해 주세요.",
    });
  }
  next();
}

// 사진 업로드를 받고 장수·용량·형식을 확인한다. 통과하면 req.menuImages = [{ buffer, mimeType }] (올린 순서)
function parseMenuImages(req, res, next) {
  menuImageUpload(req, res, uploadError => {
    if (uploadError) {
      const tooMany = uploadError.code === "LIMIT_FILE_COUNT" || uploadError.code === "LIMIT_UNEXPECTED_FILE";
      const tooLarge = uploadError.code === "LIMIT_FILE_SIZE";
      return res.status(400).json({
        error: tooMany
          ? `사진은 한 번에 최대 ${MAX_MENU_PHOTOS}장까지 올릴 수 있습니다.`
          : tooLarge
            ? "사진 한 장의 용량은 5MB 이하여야 합니다."
            : "사진 업로드 중 오류가 발생했습니다.",
      });
    }

    const files = [...(req.files?.images ?? []), ...(req.files?.image ?? [])];
    if (files.length === 0) {
      return res.status(400).json({ error: "메뉴판 사진이 없습니다." });
    }
    if (files.length > MAX_MENU_PHOTOS) {
      return res.status(400).json({ error: `사진은 한 번에 최대 ${MAX_MENU_PHOTOS}장까지 올릴 수 있습니다.` });
    }

    const images = [];
    for (const [index, file] of files.entries()) {
      const mimeType = sniffImageType(file.buffer);
      if (!mimeType) {
        return res.status(400).json({
          error: `${files.length > 1 ? `${index + 1}번째 사진: ` : ""}JPG, PNG, WEBP 형식의 사진만 올릴 수 있습니다.`,
        });
      }
      images.push({ buffer: file.buffer, mimeType });
    }

    req.menuImages = images;
    next();
  });
}

function sendMenuError(res, error, label) {
  if (error instanceof MenuOcrError) {
    return res.status(error.status).json({ error: error.message });
  }
  console.error(`${label}:`, error.message);
  res.status(500).json({ error: "메뉴판 처리에 실패했습니다." });
}

// 분석 결과만 돌려준다(저장하지 않음). 시험·미리보기용
app.post("/api/menu-ocr", requireGemini, parseMenuImages, async (req, res) => {
  const limited = checkOcrLimit(req.ip, req.menuImages.length);
  if (limited) {
    return res.status(429).json({ error: limited });
  }

  try {
    res.json(await extractMenusFromPhotos(req.menuImages, extractMenuFromImage));
  } catch (error) {
    sendMenuError(res, error, "메뉴 OCR 오류");
  }
});

// 가게의 메뉴판 사진을 제보한다: OCR → 검수 대기(menu_submissions)에 저장.
// 관리자가 승인하기 전에는 지도에 반영되지 않는다.
app.post(
  "/api/merchants/:merchantId/menu-submissions",
  requireGemini,
  attachUser, // 로그인했으면 제출자(req.user)를 기록한다. 로그인하지 않아도 막지 않는다.
  parseMenuImages,
  async (req, res) => {
    const { merchantId } = req.params;

    if (!isValidMerchantId(merchantId)) {
      return res.status(400).json({ error: "가맹점 번호가 올바르지 않습니다." });
    }

    try {
      // AI 호출 비용이 들기 전에 가게부터 확인한다.
      const merchant = await findMerchant(pool, merchantId);
      if (!merchant) {
        return res.status(404).json({ error: "가맹점을 찾을 수 없습니다." });
      }

      const photos = req.menuImages;
      const limited = checkOcrLimit(req.ip, photos.length);
      if (limited) {
        return res.status(429).json({ error: limited });
      }

      // 사진을 한 장씩 AI 에 보내고 결과를 합친다. 한 장이라도 실패하면 저장하지 않는다.
      const ocr = await extractMenusFromPhotos(photos, extractMenuFromImage);

      if (ocr.items.length === 0) {
        return res.status(422).json({
          error: "메뉴판에서 메뉴와 가격을 읽지 못했습니다. 메뉴판이 잘 보이도록 다시 촬영해 주세요.",
          rejected: ocr.rejected,
        });
      }

      const submission = await submitMenuPhoto(pool, {
        merchantId,
        merchant, // 제출 당시의 가게 이름·주소를 함께 저장한다.
        photos,
        ocr,
        user: req.user, // 로그인 기능이 붙으면 채워진다.
      });

      res.status(201).json(submission);
    } catch (error) {
      sendMenuError(res, error, "메뉴 제보 저장 오류");
    }
  }
);

// ---- 로그인·관리자 확인용 ----
// 로그인한 사용자의 정보를 돌려준다. (프론트가 "관리자인지" 알아볼 때도 쓴다.)
app.get("/api/me", requireAuth, (req, res) => {
  res.json(req.user);
});

// 관리자 검수(제보 목록·사진·승인·반려). 아래 모든 주소는 관리자만 통과한다.
// /api/admin/ping 은 로그인·관리자 설정이 제대로 됐는지 확인하는 용도.
app.use("/api/admin", requireAdmin, createAdminRouter({ db: pool }));

app.listen(PORT, () => {
  console.log(`STT 서버 실행: http://localhost:${PORT}`);
});
