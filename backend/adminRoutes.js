// 관리자 검수용 주소 모음. server.js 에서 requireAdmin 뒤에 /api/admin 으로 연결한다.
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import {
  AdminError,
  approveSubmission,
  getPhotoName,
  getSubmission,
  listSubmissions,
  parseSubmissionId,
  rejectSubmission,
} from './menuAdmin.js';
import { photoDir } from './menuSubmissions.js';
import { MAX_MENU_PHOTOS } from './menuPhotoBatch.js';

const PHOTO_TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

function handle(work) {
  return async (req, res) => {
    try {
      await work(req, res);
    } catch (error) {
      if (error instanceof AdminError) {
        return res.status(error.status).json({ error: error.message });
      }
      console.error('관리자 검수 오류:', error);
      res.status(500).json({ error: '처리 중 오류가 발생했습니다.' });
    }
  };
}

export function createAdminRouter({ db }) {
  const router = express.Router();

  router.get('/ping', (req, res) => {
    res.json({ ok: true, email: req.user.email });
  });

  router.get(
    '/submissions',
    handle(async (req, res) => {
      const items = await listSubmissions(db, { status: req.query.status || 'pending' });
      res.json({ items });
    })
  );

  router.get(
    '/submissions/:id',
    handle(async (req, res) => {
      const submission = await getSubmission(db, parseSubmissionId(req.params.id));
      if (!submission) throw new AdminError(404, '제보를 찾을 수 없습니다.');
      res.json(submission);
    })
  );

  // 원본 사진. 관리자만 볼 수 있고 브라우저에 저장(캐시)되지 않게 한다.
  async function sendPhoto(req, res, index) {
    const name = await getPhotoName(db, parseSubmissionId(req.params.id), index);
    if (!name) throw new AdminError(404, '보관 중인 사진이 없습니다.');

    const safeName = path.basename(name);
    const type = PHOTO_TYPES[path.extname(safeName).slice(1)];
    const file = path.join(photoDir(), safeName);
    if (!type || !fs.existsSync(file)) throw new AdminError(404, '사진 파일을 찾을 수 없습니다.');

    res.set({ 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.sendFile(file);
  }

  // 첫 번째 사진 (예전 주소, 그대로 둔다)
  router.get('/submissions/:id/photo', handle((req, res) => sendPhoto(req, res, 0)));

  // index 번째 사진(0부터). 한 제보에 사진이 최대 5장이다.
  router.get(
    '/submissions/:id/photos/:index',
    handle((req, res) => {
      const index = Number(req.params.index);
      if (!/^[0-9]$/.test(req.params.index) || index >= MAX_MENU_PHOTOS) {
        throw new AdminError(400, '사진 번호가 올바르지 않습니다.');
      }
      return sendPhoto(req, res, index);
    })
  );

  router.post(
    '/submissions/:id/approve',
    handle(async (req, res) => {
      const result = await approveSubmission(db, parseSubmissionId(req.params.id), {
        items: req.body?.items,
        note: req.body?.note,
        reviewer: req.user,
        // 'merge'(기본, 기존 메뉴에 추가) 또는 'replace'(통째로 교체)
        ...(req.body?.mode !== undefined ? { mode: req.body.mode } : {}),
      });
      res.json(result);
    })
  );

  router.post(
    '/submissions/:id/reject',
    handle(async (req, res) => {
      const result = await rejectSubmission(db, parseSubmissionId(req.params.id), {
        note: req.body?.note,
        reviewer: req.user,
      });
      res.json(result);
    })
  );

  return router;
}
