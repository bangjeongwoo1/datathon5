import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = path.join(ROOT, 'data')
const ADDRESS_COLUMN = '소재지도로명주소'
const LATITUDE_COLUMN = '위도'
const LONGITUDE_COLUMN = '경도'

export function parseCsv(text) {
  const records = []
  let record = []
  let field = ''
  let quoted = false
  const source = text.replace(/^\uFEFF/, '')
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') { field += '"'; index += 1 } else if (character === '"') quoted = false
      else field += character
      continue
    }
    if (character === '"') quoted = true
    else if (character === ',') { record.push(field); field = '' }
    else if (character === '\n') { record.push(field.replace(/\r$/, '')); records.push(record); record = []; field = '' }
    else field += character
  }
  if (field || record.length) { record.push(field); records.push(record) }
  const [headers = [], ...data] = records
  return data.filter((values) => values.some((value) => value !== '')).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])))
}

export function formatCsv(rows, headers) {
  const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`
  return `${[headers, ...rows.map((row) => headers.map((header) => row[header] ?? ''))].map((values) => values.map(escape).join(',')).join('\r\n')}\r\n`
}

export function hasValidCoordinates(row) {
  const latitudeText = String(row[LATITUDE_COLUMN] ?? '').trim()
  const longitudeText = String(row[LONGITUDE_COLUMN] ?? '').trim()
  if (!latitudeText || !longitudeText) return false
  const latitude = Number(latitudeText)
  const longitude = Number(longitudeText)
  return Number.isFinite(latitude) && Number.isFinite(longitude) && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180
}

export async function addressToCoordinates(address, fetchImpl = fetch) {
  const url = new URL('https://dapi.kakao.com/v2/local/search/address.json')
  url.searchParams.set('query', address)
  const response = await fetchImpl(url, { headers: { Authorization: `KakaoAK ${process.env.KAKAO_REST_API_KEY}` } })
  if (!response.ok) throw new Error(`좌표 변환 실패: ${response.status}`)
  const { documents } = await response.json()
  const place = documents[0]
  return place ? { latitude: Number(place.y), longitude: Number(place.x) } : null
}

function normalize(value) {
  return String(value ?? '').toLowerCase().replace(/[^0-9a-z가-힣]/g, '')
}

function addressTokens(value) {
  return String(value ?? '').toLowerCase().split(/[\s,()[\]·-]+/).map(normalize).filter((token) => token.length >= 2)
}

export function findKeywordMatch(merchant, documents) {
  const merchantName = normalize(merchant.가맹점명)
  const merchantTokens = new Set(addressTokens(merchant.소재지도로명주소))
  return documents.reduce((match, place) => {
    if (match) return match
    const placeName = normalize(place.place_name)
    const sameName = merchantName.length >= 4 && (placeName === merchantName || placeName.includes(merchantName) || merchantName.includes(placeName))
    const candidateTokens = addressTokens(`${place.road_address_name ?? ''} ${place.address_name ?? ''}`)
    const sharedTokens = candidateTokens.filter((token) => merchantTokens.has(token)).length
    const latitude = Number(place.y)
    const longitude = Number(place.x)
    return sameName && sharedTokens >= 2 && Number.isFinite(latitude) && Number.isFinite(longitude)
      ? { latitude, longitude }
      : null
  }, null)
}

export async function merchantToCoordinates(merchant, fetchImpl = fetch) {
  const byAddress = await addressToCoordinates(merchant[ADDRESS_COLUMN], fetchImpl)
  if (byAddress) return byAddress
  const url = new URL('https://dapi.kakao.com/v2/local/search/keyword.json')
  url.searchParams.set('query', `${merchant.가맹점명} 춘천시`)
  url.searchParams.set('x', '127.7298')
  url.searchParams.set('y', '37.8813')
  url.searchParams.set('radius', '20000')
  url.searchParams.set('size', '15')
  const response = await fetchImpl(url, { headers: { Authorization: `KakaoAK ${process.env.KAKAO_REST_API_KEY}` } })
  if (!response.ok) throw new Error(`상호명 검색 실패: ${response.status}`)
  const { documents } = await response.json()
  return findKeywordMatch(merchant, documents)
}

export async function enrichMissingCoordinates(rows, geocode, { delayMs = 0 } = {}) {
  const result = []
  const summary = { attempted: 0, enriched: 0, unresolved: 0 }
  for (const sourceRow of rows) {
    const row = { ...sourceRow }
    if (hasValidCoordinates(row)) { result.push(row); continue }
    const address = row[ADDRESS_COLUMN]?.trim()
    if (!address) { summary.unresolved += 1; result.push(row); continue }
    summary.attempted += 1
    try {
      const point = await geocode(row)
      if (point && Number.isFinite(point.latitude) && Number.isFinite(point.longitude)) {
        row[LATITUDE_COLUMN] = String(point.latitude)
        row[LONGITUDE_COLUMN] = String(point.longitude)
        summary.enriched += 1
      } else summary.unresolved += 1
    } catch (error) {
      summary.unresolved += 1
      console.warn(`좌표 변환 실패: ${address} (${error.message})`)
    }
    result.push(row)
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
  }
  return { rows: result, summary }
}

export function selectGeocodingSourceFilename(files) {
  const sources = files.filter((name) => name.startsWith('A_') && name.endsWith('.csv'))
  const enriched = sources.filter((name) => name.includes('_보완')).sort((left, right) => left.split('_보완').length - right.split('_보완').length)
  return enriched[0] ?? sources.find((name) => !name.includes('_보완'))
}

export function geocodingOutputPath(filename) {
  return filename.includes('_보완') ? filename : filename.replace(/\.csv$/i, '_보완.csv')
}

async function sourcePath() {
  const filename = selectGeocodingSourceFilename(await readdir(DATA_DIR))
  if (!filename) throw new Error('data 폴더에서 A_로 시작하는 원본 CSV를 찾을 수 없습니다.')
  return path.join(DATA_DIR, filename)
}

export async function main() {
  if (!process.env.KAKAO_REST_API_KEY) throw new Error('KAKAO_REST_API_KEY가 없습니다. frontend/.env.local을 확인하세요.')
  const input = await sourcePath()
  const rows = parseCsv(await readFile(input, 'utf-8'))
  const headers = Object.keys(rows[0] ?? {})
  for (const column of [ADDRESS_COLUMN, LATITUDE_COLUMN, LONGITUDE_COLUMN]) if (!headers.includes(column)) throw new Error(`필수 컬럼이 없습니다: ${column}`)
  const { rows: enrichedRows, summary } = await enrichMissingCoordinates(rows, merchantToCoordinates, { delayMs: 120 })
  const output = path.join(DATA_DIR, geocodingOutputPath(path.basename(input)))
  await writeFile(output, `\uFEFF${formatCsv(enrichedRows, headers)}`, 'utf-8')
  console.log(`완료: ${path.basename(output)} | 요청 ${summary.attempted}건, 보완 ${summary.enriched}건, 미확인 ${summary.unresolved}건`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1 })
}
