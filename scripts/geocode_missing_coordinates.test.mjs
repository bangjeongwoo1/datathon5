import assert from 'node:assert/strict'
import test from 'node:test'

import {
  formatCsv,
  hasValidCoordinates,
  parseCsv,
  enrichMissingCoordinates,
  selectGeocodingSourceFilename,
  geocodingOutputPath,
  findKeywordMatch,
} from './geocode_missing_coordinates.mjs'

test('enrichMissingCoordinates only geocodes rows whose coordinate pair is missing', async () => {
  const rows = [
    { 가맹점명: '기존 좌표 매장', 소재지도로명주소: '춘천시 중앙로 1', 위도: '37.8801', 경도: '127.7299' },
    { 가맹점명: '좌표 없는 매장', 소재지도로명주소: '춘천시 중앙로 2', 위도: '', 경도: '' },
  ]
  const queriedAddresses = []

  const result = await enrichMissingCoordinates(rows, async (row) => {
    queriedAddresses.push(row.소재지도로명주소)
    return { latitude: 37.881, longitude: 127.73 }
  })

  assert.deepEqual(queriedAddresses, ['춘천시 중앙로 2'])
  assert.equal(result.rows[0].위도, '37.8801')
  assert.equal(result.rows[0].경도, '127.7299')
  assert.equal(result.rows[1].위도, '37.881')
  assert.equal(result.rows[1].경도, '127.73')
  assert.deepEqual(result.summary, { attempted: 1, enriched: 1, unresolved: 0 })
})

test('enrichMissingCoordinates preserves rows that cannot be geocoded', async () => {
  const rows = [{ 가맹점명: '미확인 매장', 소재지도로명주소: '알 수 없는 주소', 위도: '', 경도: '' }]

  const result = await enrichMissingCoordinates(rows, async () => null)

  assert.equal(result.rows[0].위도, '')
  assert.equal(result.rows[0].경도, '')
  assert.deepEqual(result.summary, { attempted: 1, enriched: 0, unresolved: 1 })
})

test('CSV parser and formatter preserve quoted commas and quotes', () => {
  const original = '가맹점명,소재지도로명주소\r\n"쉼표, 매장","춘천시 \""중앙\""로 1"\r\n'
  const rows = parseCsv(original)

  assert.deepEqual(rows, [{ 가맹점명: '쉼표, 매장', 소재지도로명주소: '춘천시 "중앙"로 1' }])
  assert.deepEqual(parseCsv(formatCsv(rows, ['가맹점명', '소재지도로명주소'])), rows)
})

test('hasValidCoordinates requires both values to be within geographic bounds', () => {
  assert.equal(hasValidCoordinates({ 위도: '37.88', 경도: '127.73' }), true)
  assert.equal(hasValidCoordinates({ 위도: '37.88', 경도: '' }), false)
  assert.equal(hasValidCoordinates({ 위도: '100', 경도: '127.73' }), false)
})

test('selectGeocodingSourceFilename resumes from the enriched CSV when it exists', () => {
  assert.equal(
    selectGeocodingSourceFilename(['A_가맹점_좌표통합.csv', 'A_가맹점_좌표통합_보완_보완.csv', 'A_가맹점_좌표통합_보완.csv']),
    'A_가맹점_좌표통합_보완.csv',
  )
  assert.equal(selectGeocodingSourceFilename(['A_가맹점_좌표통합.csv']), 'A_가맹점_좌표통합.csv')
})

test('geocodingOutputPath keeps the same enriched filename on retries', () => {
  assert.equal(geocodingOutputPath('A_가맹점_좌표통합.csv'), 'A_가맹점_좌표통합_보완.csv')
  assert.equal(geocodingOutputPath('A_가맹점_좌표통합_보완.csv'), 'A_가맹점_좌표통합_보완.csv')
})

test('findKeywordMatch accepts only a store name and address match', () => {
  const merchant = { 가맹점명: '김밥천국 춘천점', 소재지도로명주소: '강원 춘천시 중앙로 10' }
  const documents = [
    { place_name: '김밥천국 춘천점', road_address_name: '강원 춘천시 중앙로 10', address_name: '', x: '127.73', y: '37.88' },
    { place_name: '김밥천국 서울점', road_address_name: '서울 중구 중앙로 10', address_name: '', x: '126.98', y: '37.56' },
  ]

  assert.deepEqual(findKeywordMatch(merchant, documents), { latitude: 37.88, longitude: 127.73 })
  assert.equal(findKeywordMatch(merchant, [documents[1]]), null)
})
