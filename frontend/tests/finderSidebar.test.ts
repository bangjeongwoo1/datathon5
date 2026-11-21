import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { SIDEBAR_STORAGE_KEY, loadSidebarOpen, saveSidebarOpen } from '../src/finderSidebar.ts'

const memoryStorage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  }
}

const brokenStorage = {
  getItem: () => {
    throw new Error('저장소 접근 차단')
  },
  setItem: () => {
    throw new Error('저장소 접근 차단')
  },
}

test('저장된 값이 없으면 목록은 펼친 상태다', () => {
  assert.equal(loadSidebarOpen(memoryStorage()), true)
})

test('접은 상태를 저장하면 다음에도 접힌 채로 읽힌다', () => {
  const storage = memoryStorage()
  saveSidebarOpen(false, storage)
  assert.equal(storage.data.get(SIDEBAR_STORAGE_KEY), 'closed')
  assert.equal(loadSidebarOpen(storage), false)

  saveSidebarOpen(true, storage)
  assert.equal(storage.data.get(SIDEBAR_STORAGE_KEY), 'open')
  assert.equal(loadSidebarOpen(storage), true)
})

test('알 수 없는 값이 들어 있으면 펼친 상태로 본다', () => {
  assert.equal(loadSidebarOpen(memoryStorage({ [SIDEBAR_STORAGE_KEY]: '???' })), true)
})

test('저장소를 못 쓰는 환경(차단·시크릿 창)에서도 오류 없이 펼친 상태로 동작한다', () => {
  assert.equal(loadSidebarOpen(brokenStorage), true)
  assert.doesNotThrow(() => saveSidebarOpen(false, brokenStorage))
  assert.equal(loadSidebarOpen(null), true)
  assert.doesNotThrow(() => saveSidebarOpen(false, null))
})

test('접기 손잡이: 열림 상태와 이름을 알리고, 목록과 연결되어 있으며, 모바일에서는 숨긴다', () => {
  const root = path.resolve(import.meta.dirname, '..')
  const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8')
  assert.match(app, /className="sidebar-toggle"/)
  assert.match(app, /aria-expanded=\{sidebarOpen\}/)
  assert.match(app, /aria-controls="finder-sidebar"/)
  assert.match(app, /id="finder-sidebar"/)
  assert.match(app, /가맹점 목록 접기/)
  assert.match(app, /가맹점 목록 펼치기/)

  const css = fs.readFileSync(path.join(root, 'src/FinderDesign.css'), 'utf8')
  assert.match(css, /@media\(max-width:760px\)\{\.finder-design \.sidebar-toggle\{display:none\}\}/)
  // 접힘 스타일은 데스크톱(761px 이상)에서만 목록을 숨긴다.
  assert.match(css, /@media\(min-width:761px\)\{[^@]*data-sidebar='closed'\] \.sidebar\{[^}]*visibility:hidden/)
})

test('음성 안내 카드: 기본은 펼친 상태이고, 접은 상태를 따로 저장·복원한다(목록 상태와 섞이지 않는다)', async () => {
  const { VOICE_CARD_STORAGE_KEY, loadVoiceCardOpen, saveVoiceCardOpen } = await import('../src/finderSidebar.ts')
  const storage = memoryStorage()
  assert.equal(loadVoiceCardOpen(storage), true)

  saveVoiceCardOpen(false, storage)
  assert.equal(storage.data.get(VOICE_CARD_STORAGE_KEY), 'closed')
  assert.equal(loadVoiceCardOpen(storage), false)
  assert.equal(loadSidebarOpen(storage), true, '목록 상태는 그대로 펼침이어야 한다')

  saveSidebarOpen(false, storage)
  saveVoiceCardOpen(true, storage)
  assert.equal(loadSidebarOpen(storage), false)
  assert.equal(loadVoiceCardOpen(storage), true)

  assert.equal(loadVoiceCardOpen(brokenStorage), true)
  assert.doesNotThrow(() => saveVoiceCardOpen(false, brokenStorage))
})

test('접어 둔 음성 카드: 새 답변·오류가 오면 펼치고, 같은 내용이 되풀이되거나 들은 말만 바뀌면 펼치지 않는다', async () => {
  const { revealVoiceCard } = await import('../src/finderSidebar.ts')
  const status = (over: Partial<{ heard: string; answer: string; error: string }> = {}) => ({ heard: '', answer: '', error: '', ...over })

  let r = revealVoiceCard('', status())
  assert.equal(r.reveal, false, '아무 내용 없는 초기 상태')

  r = revealVoiceCard(r.signal, status({ heard: '근처 식당' }))
  assert.equal(r.reveal, false, '들은 말만 있으면(답 전) 펼치지 않는다')

  r = revealVoiceCard(r.signal, status({ heard: '근처 식당', answer: '가까운 곳을 찾았어요.' }))
  assert.equal(r.reveal, true, '새 답변이 오면 펼친다')

  const again = revealVoiceCard(r.signal, status({ heard: '근처 식당', answer: '가까운 곳을 찾았어요.' }))
  assert.equal(again.reveal, false, '같은 답변이 되풀이돼도 사용자가 접은 카드를 다시 펼치지 않는다')

  r = revealVoiceCard(again.signal, status({ heard: '근처 식당', answer: '가까운 곳을 찾았어요.', error: '재생에 실패했어요.' }))
  assert.equal(r.reveal, true, '새 오류가 오면 펼친다')
})

test('모바일 지도 화면에서 검색 카드·음성 카드를 접는 버튼이 있고, 목록(찾기) 화면과 데스크톱에는 영향이 없다', () => {
  const root = path.resolve(import.meta.dirname, '..')
  const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8')
  assert.match(app, /className="sidebar-fold"/)
  assert.match(app, /className="sidebar-reopen"/)
  assert.match(app, /className="voice-live-fold"/)
  assert.match(app, /className="voice-reopen"/)
  assert.match(app, /data-collapsed=\{!voiceCardOpen\}/)
  assert.match(app, /aria-controls="voice-live-status"/)

  const css = fs.readFileSync(path.join(root, 'src/FinderDesign.css'), 'utf8')
  // 접힘은 모바일 "지도" 화면(data-view=map)에서만 목록 카드를 숨긴다.
  assert.match(css, /@media\(max-width:760px\)\{[^@]*data-view=map\]\[data-sidebar='closed'\] \.sidebar\{[^}]*visibility:hidden/)
  // 접기 버튼은 기본으로 숨기고, 모바일 지도 화면에서만 보인다.
  assert.match(css, /\.finder-design \.sidebar-fold,\.finder-design \.sidebar-reopen\{display:none\}/)
  assert.match(css, /data-view=map\] \.sidebar-fold\{display:flex/)
  // 접힌 음성 카드는 숨긴다.
  assert.match(css, /\.voice-live-status\[data-collapsed=true\]\{display:none\}/)
})
