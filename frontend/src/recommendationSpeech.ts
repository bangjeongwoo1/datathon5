// guide-speech accepts up to 400 characters, including the consent question.
export function recommendationSpeech(reply: string, storeName: string) {
  const question = storeName.length <= 150 ? `${storeName}까지 길 안내할까요?` : '이 식당까지 길 안내할까요?'
  const limit = 400 - question.length - 1
  let explanation = reply.trim()
  if (explanation.length > limit) {
    const clipped = explanation.slice(0, limit - 1).trimEnd()
    const sentence = clipped.match(/^[\s\S]*[.!?。！？](?:\s|$)/)?.[0].trim()
    explanation = sentence || `${clipped}…`
  }
  return `${explanation} ${question}`
}
