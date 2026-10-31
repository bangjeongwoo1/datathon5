import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveApiBaseUrl } from '../src/apiUrl.ts'

test('배포 API 주소 끝의 슬래시를 제거하고 경로를 결합한다', () => {
  assert.equal(
    resolveApiBaseUrl('https://eatda-api.onrender.com/'),
    'https://eatda-api.onrender.com',
  )
})

test('API 주소가 없으면 로컬 백엔드 주소를 사용한다', () => {
  assert.equal(resolveApiBaseUrl(undefined), 'http://localhost:3001')
})
