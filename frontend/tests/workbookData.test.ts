import { test } from 'node:test'
import assert from 'node:assert/strict'
import { merchants } from '../src/merchants.ts'

test('uses the generated workbook merchant list without unsupported phone data', () => {
  assert.ok(merchants.length > 4_000)
  assert.ok(merchants.every(merchant => merchant.name && merchant.address && merchant.rawCategory && merchant.detailCategory))
  assert.ok(merchants.every(merchant => !('phone' in merchant)))
  assert.ok(merchants.filter(merchant => merchant.coordinates).length > 4_000)
})
