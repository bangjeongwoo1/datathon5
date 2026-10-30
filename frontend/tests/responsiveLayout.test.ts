import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const cssUrl = new URL('../src/App.css', import.meta.url)

test('mobile layout keeps filters touchable, the store list compact, and the map visible', async () => {
  const css = await readFile(cssUrl, 'utf8')

  assert.match(css, /@media\(max-width:760px\).*?\.chips\{[^}]*flex-wrap:nowrap[^}]*overflow-x:auto/s)
  assert.match(css, /@media\(max-width:760px\).*?\.chip\{[^}]*min-height:36px/s)
  assert.match(css, /@media\(max-width:760px\).*?\.store-list\{[^}]*max-height:min\(48svh,440px\)/s)
  assert.match(css, /@media\(max-width:760px\).*?\.map\{[^}]*min-height:min\(64svh,520px\)/s)
  assert.match(css, /@media\(max-width:390px\).*?\.nav-active::after\{content:'찾기'/s)
})
