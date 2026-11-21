// 테스트 전용: 엑셀 원본에서 만든 옛 정적 가맹점 목록(scripts/generate_merchants.py 가 생성).
// 앱은 가게 목록을 서버 API(merchant_crawl_staging)에서 받으므로 이 데이터를 쓰지 않는다.
// src/merchants.ts 에서 불러오면 쓰지 않는데도 배포 파일에 1MB 가까이 들어가서 테스트 쪽으로 옮겼다.
import { sourceMerchants } from '../src/data/merchants.generated.ts'
import { toMerchant } from '../src/merchantData.ts'
import type { Merchant } from '../src/merchants.ts'

export const merchants: Merchant[] = sourceMerchants.map(toMerchant)
