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
