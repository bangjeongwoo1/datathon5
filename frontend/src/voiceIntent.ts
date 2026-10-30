
export function parseVoiceIntent(text: string) {
  const sentence = text.trim()

  if (/빵집|베이커리|제과점|제빵|빵/.test(sentence)) {
    return { query: '', categoryIndex: 3 }
  }

  if (/편의점/.test(sentence)) {
    return { query: '', categoryIndex: 2 }
  }

  if (/식당|일반음식점/.test(sentence)) {
    return { query: '', categoryIndex: 1 }
  }

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
