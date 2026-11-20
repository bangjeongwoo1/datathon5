export function markerSvg(color: string) {
  const outline = 'M20 44C17 39 5 27 5 19C5 10.7 11.7 4 20 4C28.3 4 35 10.7 35 19C35 27 23 39 20 44Z'
  // 흰색 외곽선이 겹친 마커를 분리하고, 색상 테두리와 중심점이 업종을 구분한다.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="48" viewBox="0 0 40 48"><path d="${outline}" fill="white" stroke="white" stroke-width="5" stroke-linejoin="round"/><path d="${outline}" fill="white" stroke="${color}" stroke-width="2.5" stroke-linejoin="round"/><circle cx="20" cy="19" r="5" fill="${color}"/></svg>`
}

// 사용자의 현재 위치를 가맹점 핀과 구분되는 빨간 점으로 표시 (옅은 후광 + 흰 테두리)
export function currentLocationSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26"><circle cx="13" cy="13" r="12" fill="#ef4444" fill-opacity="0.2"/><circle cx="13" cy="13" r="7" fill="#ef4444" stroke="white" stroke-width="2.5"/></svg>`
}
