import { test } from 'node:test'
import assert from 'node:assert/strict'
import { markerSvg } from '../src/markerIcon.ts'

test('uses color-only marker artwork without category text', () => {
  const svg = markerSvg('#15957e')
  assert.match(svg, /fill="#15957e"/)
  assert.doesNotMatch(svg, /<text|>C<|>B<|>식</)
})
