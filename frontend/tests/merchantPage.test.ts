import assert from 'node:assert/strict'
import test from 'node:test'
import { merchantPage, LIST_PAGE_SIZE } from '../src/merchantPage.ts'

test('최초 30개만 표시하고 더 보기에서 기존 순서대로 확장한다', () => {
  const stores = Array.from({length:100},(_,i)=>({id:i+1}))
  assert.equal(merchantPage(stores,LIST_PAGE_SIZE,null).length,30)
  assert.deepEqual(merchantPage(stores,60,null),stores.slice(0,60))
  assert.equal(stores.length,100)
})

test('지도 선택 매장은 목록 범위 밖에서도 표시하고 중복시키지 않는다', () => {
  const stores = Array.from({length:100},(_,i)=>({id:i+1}))
  assert.equal(merchantPage(stores,30,99)[0].id,99)
  assert.equal(merchantPage(stores,30,10).length,30)
  assert.deepEqual(merchantPage([],30,99),[])
})
