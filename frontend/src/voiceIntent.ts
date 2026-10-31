
export function parseVoiceIntent(text: string) {
  const sentence = text.trim()

  // 빵집 및 제과점
  if (/빵집|베이커리|제과점|제빵|빵/.test(sentence)) {
    return { query: '', categoryIndex: 5 }
  }

  // 편의점
  if (/편의점/.test(sentence)) {
    return { query: '', categoryIndex: 6 }
  }

  // 마트
  if (/마트|슈퍼마켓/.test(sentence)) {
    return { query: '', categoryIndex: 7 }
  }

  // 음식점 종류
  if (/한식/.test(sentence)) {
    return { query: '', categoryIndex: 1 }
  }

  if (/중식|중국집/.test(sentence)) {
    return { query: '', categoryIndex: 2 }
  }

  if (/일식|일본식/.test(sentence)) {
    return { query: '', categoryIndex: 3 }
  }

  if (/양식/.test(sentence)) {
    return { query: '', categoryIndex: 4 }
  }

  // 식당 전체
  if (/식당|음식점/.test(sentence)) {
    return { query: '', categoryIndex: 0 }
  }

  // 음식 이름으로 검색
  const foods = [
    '김밥', '떡볶이', '라면', '치킨',
    '피자', '햄버거', '국밥',
    '돈가스', '돈까스', '샌드위치'
  ]

  for (const food of foods) {
    if (sentence.includes(food)) {
      return { query: food, categoryIndex: 0 }
    }
  }

  return { query: sentence, categoryIndex: 0 }
}
