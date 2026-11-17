
export function parseVoiceIntent(text: string) {
  const sentence = text.trim()

  // 베이커리 및 간식
  if (/빵집|베이커리|제과점|제빵|빵/.test(sentence)) {
    return { query: '', category: '베이커리/간식' }
  }

  // 편의점
  if (/편의점/.test(sentence)) {
    return { query: '', category: '편의점' }
  }

  // 마트 및 슈퍼
  if (/마트|슈퍼마켓|슈퍼/.test(sentence)) {
    return { query: '', category: '마트' }
  }

  // 세부 음식점 업종은 DB에서 별도 확정하지 않았으므로
  // 상호명 및 세부 업종 문자열 검색으로 처리
  const cuisine = sentence.match(
    /한식|중식|중국집|일식|일본식|양식/
  )

  if (cuisine) {
    return {
      query: cuisine[0],
      category: '일반음식점',
    }
  }

  // 일반 음식점 전체
  if (/식당|음식점|밥집/.test(sentence)) {
    return { query: '', category: '일반음식점' }
  }

  // 음식 이름 검색
  const foods = [
    '김밥',
    '떡볶이',
    '라면',
    '치킨',
    '피자',
    '햄버거',
    '국밥',
    '돈가스',
    '돈까스',
    '샌드위치',
  ]

  for (const food of foods) {
    if (sentence.includes(food)) {
      return { query: food, category: '전체' }
    }
  }

  return {
    query: sentence,
    category: '전체',
  }
}
