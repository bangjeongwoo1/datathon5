// Short answers only authorize the action that was actually offered in this conversation.
export function spokenConsent(text: string, action: 'route' | 'call' = 'route'): 'accept' | 'decline' | null {
  const value = text.normalize('NFKC').replace(/[\s,.!。！]/g, '')
  if (/[?？]/.test(value)) return null
  if (/^(?:아니|아니요|괜찮아|괜찮아요|됐어|됐어요|안할래|하지마|하지말아줘|안내하지마|취소|그대로)$/.test(value)) return 'decline'
  if (/^(?:응|어|네|예|좋아|좋아요|그래|그래요|알았어|알았어요|알았다|알겠어|알겠어요|알겠습니다|부탁해|부탁해요|부탁할게|가자|해줘|해주세요)$/.test(value)) return 'accept'
  if (action === 'route' && /^(?:(?:응|네|예|그래|좋아)[,.]?)?(?:(?:여기|거기|그곳|그리)(?:로)?)?(?:길|경로)?안내(?:를)?(?:시작)?해(?:줘|주세요|줘요)$/.test(value)) return 'accept'
  return null
}
