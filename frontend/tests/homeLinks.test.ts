import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { HOME_CARDS } from '../src/home/links.ts'

const root = path.resolve(import.meta.dirname, '..')
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')

test('첫 화면 카드는 가맹점 지도와 가맹 권유 지도, 두 장이다', () => {
  assert.deepEqual(HOME_CARDS.map(card => [card.id, card.href]), [
    ['finder', '/finder.html'],
    ['mealcard', '/mealcard.html'],
  ])
})

test('카드가 가리키는 페이지는 실제로 있고, 빌드(vite.config.ts)에도 들어 있다', () => {
  const config = read('vite.config.ts')
  for (const card of HOME_CARDS) {
    const file = card.href.slice(1)
    assert.ok(fs.existsSync(path.join(root, file)), `${file} 파일이 없습니다`)
    assert.match(config, new RegExp(`'${file}'`), `${file} 이 vite.config.ts 의 input 에 없습니다`)
  }
  assert.match(config, /'index\.html'/)
})

test('카드마다 스크린리더가 구분할 수 있는 링크 이름이 있다', () => {
  const labels = HOME_CARDS.map(card => card.linkLabel)
  assert.equal(new Set(labels).size, labels.length)
  for (const label of labels) assert.match(label, /자세히 보기$/)
})

test('/ 는 첫 화면, 가맹점 지도 앱은 finder.html 이 연다', () => {
  assert.match(read('index.html'), /\/src\/home\/main\.tsx/)
  assert.match(read('finder.html'), /\/src\/main\.tsx/)
  assert.match(read('index.html'), /<title>잇다\(EATDA\)/)
})

test('지도 앱과 가맹 권유 지도에서 서로·첫 화면으로 가는 링크가 새 주소를 쓴다', () => {
  assert.match(read('src/mealcard/MealcardApp.tsx'), /finder\.html/)
  assert.match(read('src/App.tsx'), /<a href="\/">홈<\/a>/)
})
