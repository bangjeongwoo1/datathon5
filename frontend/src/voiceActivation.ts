export function findVoiceWake(text: string) {
  const spoken = text.normalize('NFKC').replace(/[。！？“”‘’"':：]/g, ' ').trim()
  const wake = spoken.match(/(?:^|[,.!?\s])(?:(?:안녕|헤이|헤이요)\s*(?:잇다|잇따|이따|있다|이다|이타)(?:\s*야)?|(?:잇다|잇따|이따|있다|이다|이타)[,.!?\s]*도우미|(?:잇다|잇따|이따|있다|이다|이타)\s*야)[,.!?\s]*/)
  return { spoken, wake }
}

export function activateVoice(text: string, conversationActive: boolean) {
  const { spoken, wake } = findVoiceWake(text)
  if (wake) {
    const command = spoken.slice((wake.index ?? 0) + wake[0].length).trim()
    if (!command) return { command: '잇다야', woke: true }
    return { command, woke: true }
  }
  return conversationActive && spoken && !/^(?:감사합니다|시청해 주셔서 감사합니다)[.!\s]*$/.test(spoken) ? { command: spoken, woke: false } : null
}

export function guideSelection(text: string): number | 'current' | null {
  // Use the same wake-word normalization for typed requests and recorded STT.
  const command = normalizeVoiceCommand(text).replace(/[\s,.!?。！？]/g, '')
  const request = '(?:(?:길)?안내(?:를)?(?:시작)?(?:해(?:줘요?|주세요|줄래요?|주실래요|주라)?)?|가자|선택(?:해(?:줘요?|주세요))?|가줘|가주세요|데려다줘)'
  if (new RegExp(`^(?:여기|이곳|이가게|이식당|이쪽)(?:으?로)?${request}$`).test(command)) return 'current'
  const numbered = command.match(new RegExp(`^(첫번째|두번째|세번째|[123]번)(?:가게|식당)?(?:으?로)?(?:${request})?$`))
  if (!numbered) return null
  return /첫|1/.test(numbered[1]) ? 0 : /두|2/.test(numbered[1]) ? 1 : 2
}

export function normalizeVoiceCommand(text: string) {
  const { spoken, wake } = findVoiceWake(text)
  return wake && wake.index === 0 ? spoken.slice(wake[0].length).trim() : spoken
}
