import { combineVoiceSignals, voiceTimeoutSignal } from './voiceTransport.ts'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { apiUrl } from './apiUrl'
import { createGuideSpeech } from './guideSpeech'
import { mealsWithinBudget } from './mealPrice'
import { createHandsFree } from './recordedHandsFree'
import { GuideLocationError, requestNavigationFix, watchNavigationFix } from './guideLocation'
import { estimateArrival, estimateRouteEnd, arrivalCommand, merchantCallUrl, helpCallScript, requestMerchantCall } from './arrivalAssist'
import type { ArrivalReading } from './arrivalAssist'
import { guideSelection, normalizeVoiceCommand } from './voiceActivation'
import { spokenConsent } from './spokenConsent'
import { recommendationSpeech } from './recommendationSpeech'
import type { Merchant } from './merchants'
import VoiceSearch from './VoiceSearch'
import { parseVoiceIntent } from './voiceIntent'
import { distanceBetween, projectOntoRoute } from './walkingProgress'
import type { Point, WalkingRoute } from './walkingProgress'
import './VoiceGuide.css'

type Fix = Point & { accuracy: number }
type Query = { terms: string; category: string; budget: number | null }
type Intent = { action: 'search' | 'navigate' | 'call' | 'closer' | 'remaining' | 'sign' | 'yes' | 'no' | 'reply'; query?: Query; reply?: string }
type Option = { store: Merchant; route: WalkingRoute; search: Query }
type ArrivalState = { store: Merchant; reading: ArrivalReading; stage: 'nearby' | 'help-offered' | 'call-ready' | 'confirmed' }
export type VoiceStatus = { enabled: boolean; message: string; heard: string; answer: string; error: string }
class GuideApiError extends Error {
  status: number
  path: string
  code: string
  constructor(path: string, status: number, code = '') {
    super('안내 API 요청 실패')
    this.path = path
    this.status = status
    this.code = code
  }
}
const MAX_ACCURACY = 35
const meters = (value: number) => value >= 1000
  ? `약 ${(value / 1000).toFixed(1)}킬로미터`
  : `약 ${Math.max(0, Math.round(value / 5) * 5)}미터`

async function post<T>(path: string, body: unknown, signal: AbortSignal): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: combineVoiceSignals([signal, voiceTimeoutSignal(15000)]),
  })
  if (!response.ok) {
    const data = await response.json().catch(() => null)
    throw new GuideApiError(path, response.status, typeof data?.error === 'string' ? data.error : '')
  }
  return response.json() as Promise<T>
}

function aiFailureMessage(error: unknown) {
  if (error instanceof GuideApiError) {
    if (error.code === 'AI_NOT_CONFIGURED') return '대화 AI의 서버 설정이 빠져 있어요. 서버의 Groq 키와 텍스트 모델 설정을 확인해 주세요.'
    if (error.code === 'AI_AUTH_FAILED') return '대화 AI 인증이 거절됐어요. 서버의 Groq 키와 모델 사용 권한을 확인해 주세요.'
    if (error.status === 429) return '대화 AI의 요청 한도에 도달했어요. 잠시 후 다시 말씀해 주세요.'
    if (error.status === 404) return '연결된 서버에 대화 AI 기능이 없어요. 서버 배포와 API 주소를 확인해 주세요.'
    if (error.code === 'AI_INVALID_RESPONSE') return '대화 AI의 응답을 처리하지 못했어요. 같은 요청을 다시 말씀해 주세요.'
  }
  return '대화 AI가 이번 요청에 응답하지 못했어요. 잠시 후 다시 말씀해 주세요.'
}

function localIntent(text: string): Intent {
  if (/얼마나.*남|남은 거리|몇 미터 남/.test(text)) return { action: 'remaining' }
  if (/가까운.*(없|곳|데)|더 가까|가까운.*다른/.test(text)) {
    if (/더|다른/.test(text)) return { action: 'closer' }
  }
  if (/여기.*맞|간판|도착.*확인/.test(text)) return { action: 'sign' }
  if (/^(네|응|예|좋아요?|바꿔\s*줘|바꿔|그래|목적지 변경)([,!.\s]*바꿔\s*줘)?[.!\s]*$/.test(text)) return { action: 'yes' }
  if (/^(아니|아니요|됐어|취소|그대로)[.!\s]*$/.test(text)) return { action: 'no' }
  const amount = text.match(/([0-9,]+)\s*원/)
  const tenThousands = text.match(/([1-9][0-9]*)\s*만\s*원/)
  const budget = amount ? Number(amount[1].replaceAll(',', ''))
    : tenThousands ? Number(tenThousands[1]) * 10000
    : /(?:^|\s)(?:일\s*)?만\s*원/.test(text) ? 10000 : null
  const intent = parseVoiceIntent(text)
  const general = /근처|먹을|추천|만원|원\s*이하/.test(text)
  return {
    action: 'search',
    query: {
      budget,
      category: intent.category === '전체' && general ? '일반음식점' : intent.category,
      terms: general && intent.query === text.trim() ? '' : intent.query,
    },
  }
}

function availableMenu(store: Merchant, query: Query) {
  return mealsWithinBudget(store.confirmedMeals, query.budget).filter(meal =>
    (!query.terms || meal.name.includes(query.terms)),
  ).sort((a, b) => a.price - b.price)[0]
}


export default function VoiceGuide({ stores, selected, onSelect, maximumPrice, onBudgetSearch, dataReady, onActivity, onStatus, routeRequest = 0 }: {
  stores: Merchant[]
  selected?: Merchant
  onSelect: (store: Merchant) => void
  maximumPrice: number | null
  onBudgetSearch: (price: number | null) => void
  dataReady: boolean
  routeRequest?: number
  onActivity?: () => void
  onStatus?: (status: VoiceStatus) => void
}) {
  const [status, setStatus] = useState('')
  const [text, setText] = useState('')
  const [results, setResults] = useState<{ store: Merchant; search: Query }[]>([])
  const [resultIndex, setResultIndex] = useState(0)
  const routeOffer = useRef<{ store: Merchant; search: Query } | null>(null)
  const conversation = useRef<{ role: 'user' | 'assistant'; text: string }[]>([])
  const [voiceEnabled, setVoiceEnabled] = useState(false)
  const [listeningStatus, setListeningStatus] = useState('')
  const [heard, setHeard] = useState<{ text: string; accepted: boolean } | null>(null)
  const [handsFree] = useState(() => createHandsFree(
    () => {},
    (enabled, message) => {
      setVoiceEnabled(enabled)
      setListeningStatus(message)
    },
    (text, accepted) => { setHeard({ text, accepted }); if (accepted) onActivity?.() },
  ))
  const [active, setActive] = useState<Option | null>(null)
  const [proposal, setProposal] = useState<Option | null>(null)
  const [arrival, setArrival] = useState<ArrivalState | null>(null)
  const arrivalRef = useRef<ArrivalState | null>(null)
  function updateArrival(next: ArrivalState | null) { arrivalRef.current = next; setArrival(next) }
  const [busy, setBusy] = useState(false)
  const [speechError, setSpeechError] = useState('')
  const [playbackStatus, setPlaybackStatus] = useState('')
  const [speech] = useState(() => createGuideSpeech(undefined, setSpeechError,
    speaking => handsFree.pause('speech', speaking), setPlaybackStatus))
  const query = useRef<Query>({ terms: '', category: '일반음식점', budget: null })
  const pending = useRef<AbortController | null>(null)
  const recording = useRef(false)
  const phoneRequested = useRef(false)
  const phoneAppHidden = useRef(false)
  const voiceManuallyStopped = useRef(false)
  const waitingCommand = useRef<string | null>(null)
  const answerRequest = useRef<AbortController | null>(null)
  const lastQuestion = useRef('')
  const [aiNotice, setAiNotice] = useState('')
  const announcedReady = useRef(false)

  useEffect(() => {
    onStatus?.({ enabled: voiceEnabled, message: busy ? '요청을 확인하고 있어요.' : listeningStatus || '마이크 연결 중', heard: heard?.text || '', answer: status, error: speechError || playbackStatus })
  }, [onStatus, voiceEnabled, busy, listeningStatus, heard, status, speechError, playbackStatus])

  useEffect(() => {
    if (!announcedReady.current && voiceEnabled && listeningStatus.startsWith('마이크가 준비됐어요')) {
      announcedReady.current = true
      void speech.speak('잇다가 듣고 있어요. 잇다야, 근처 식당 찾아줘라고 말씀해 주세요.')
    }
  }, [voiceEnabled, listeningStatus, speech])

  useEffect(() => () => {
    pending.current?.abort()
    answerRequest.current?.abort()
    speech.stop()
    handsFree.dispose()
  }, [speech, handsFree])

  useEffect(() => {
    handsFree.pause('request', busy)
  }, [busy, handsFree])

  useEffect(() => {
    const hide = () => {
      if (document.hidden) {
        phoneAppHidden.current = phoneRequested.current
        handsFree.stop('다른 화면을 보는 동안 마이크를 쉬고 있어요.')
        speech.stop()
      } else if (!voiceManuallyStopped.current && (!phoneRequested.current || phoneAppHidden.current)) {
        const returningFromPhone = phoneAppHidden.current
        phoneAppHidden.current = false
        phoneRequested.current = false
        handsFree.start()
        if (returningFromPhone) {
          if (arrivalRef.current) updateArrival({ ...arrivalRef.current, stage: 'nearby' })
          say('전화 앱에서 돌아왔어요. 실제 통화 여부는 확인할 수 없어요. 잇다가 다시 듣고 있어요.')
        }
      }
    }
    const leaveForPhone = () => {
      if (phoneRequested.current) {
        phoneAppHidden.current = true
        handsFree.stop('전화 연결을 요청해 마이크 인식을 멈췄어요.')
      }
    }
    const returnFromPhone = () => {
      if (phoneRequested.current && phoneAppHidden.current) hide()
    }
    if (!document.hidden) handsFree.start()
    document.addEventListener('visibilitychange', hide)
    window.addEventListener('blur', leaveForPhone)
    window.addEventListener('focus', returnFromPhone)
    return () => {
      document.removeEventListener('visibilitychange', hide)
      window.removeEventListener('blur', leaveForPhone)
      window.removeEventListener('focus', returnFromPhone)
    }
  }, [handsFree, speech])

  function facts(items = results) {
    return items.slice(0, 3).map(({ store }) => ({
      name: store.name, address: store.address, category: store.category,
      meals: store.confirmedMeals ?? [],
    }))
  }

  async function readOption(items: typeof results, index: number) {
    const option = items[index]
    if (!option) return say('먼저 가맹점을 검색해 주세요.')
    answerRequest.current?.abort()
    const request = new AbortController()
    answerRequest.current = request
    setStatus('조회한 가맹점 정보를 바탕으로 답변을 준비하고 있어요.')
    try {
      const answer = await post<{ reply: string }>('/api/guide-answer', {
        text: lastQuestion.current || '현재 선택된 가맹점과 확인된 메뉴를 설명해 주세요.',
        facts: facts(items), recommendedName: option.store.name,
        selectedName: selected?.id === option.store.id ? selected.name : '',
        history: conversation.current, offerRoute: false,
      }, combineVoiceSignals([request.signal, voiceTimeoutSignal(12000)]))
      if (request.signal.aborted) return
      if (typeof answer.reply !== 'string' || !answer.reply.trim()) throw new Error('Empty answer')
      setAiNotice('')
      routeOffer.current = option.store.coordinates ? option : null
      if (routeOffer.current) handsFree.requestCommand()
      return say(routeOffer.current ? recommendationSpeech(answer.reply, option.store.name) : answer.reply)
    } catch (error) {
      if (request.signal.aborted) return
      setAiNotice('대화 AI 응답 재시도가 필요해요.')
      return say(aiFailureMessage(error))
    }
  }

  function say(message: string) {
    conversation.current = [...conversation.current, { role: 'assistant' as const, text: message }].slice(-8)
    setStatus(message)
    if (!recording.current) void speech.speak(message)
  }

  useEffect(() => {
    if (!active) return
    let previous = ''
    let lastStep = -1
    const turns = active.route.steps.map(step => ({
      ...step,
      offset: projectOntoRoute(active.route, step.point).offset,
    })).sort((a, b) => a.offset - b.offset)
    function speakOnce(message: string) {
      if (previous === message) return
      setStatus(message)
      if (!recording.current) {
        void speech.speak(message)
        previous = message
      }
    }
    const receiveFix = (fix: Fix) => {
      if (phoneRequested.current || document.hidden) return
      if (fix.accuracy > MAX_ACCURACY) {
        speakOnce('GPS 위치 오차가 커서 방향 안내를 잠시 멈췄어요.')
        return
      }
      const progress = projectOntoRoute(active.route, fix)
      if (progress.gap > Math.max(30, fix.accuracy)) {
        speakOnce('현재 위치가 안내 경로에서 벗어나 방향 안내를 잠시 멈췄어요.')
        return
      }
      if (active.store.coordinates) {
        const remaining = Math.max(0, active.route.meters - progress.offset)
        let reading = estimateArrival(fix, active.store.coordinates, remaining)
        const atRouteEnd = reading.proximity === 'outside'
          ? estimateRouteEnd(fix, active.route.segments.at(-1)?.path.at(-1), remaining) : null
        if (atRouteEnd) reading = atRouteEnd
        if (reading.proximity !== 'outside') {
          const currentArrival = arrivalRef.current
          if (!currentArrival || currentArrival.store.id !== active.store.id) {
            const canCall = Boolean(merchantCallUrl(active.store.phone))
            routeOffer.current = null
            updateArrival({ store: active.store, reading, stage: canCall ? 'help-offered' : 'nearby' })
            handsFree.requestCommand()
            onActivity?.()
            const proximityMessage = atRouteEnd
              ? '안내 경로의 끝 근처로 보이지만 가게 위치는 아직 확인되지 않았어요.'
              : reading.proximity === 'uncertain'
              ? `${active.store.name} 근처로 보이지만 위치 오차가 커요.`
              : reading.proximity === 'very-close'
                ? `${active.store.name}의 등록 좌표에서 약 2미터 이내로 추정돼요.`
                : `${active.store.name} 근처로 추정돼요.`
            speakOnce(`${proximityMessage} 출입구는 아직 확인되지 않았어요. ${canCall
              ? '가게에 전화를 걸어 입구 안내를 부탁할까요? 원하시면 “응”, 원하지 않으면 “아니요”라고 말씀하세요.'
              : '등록된 연결 가능한 전화번호가 없어요. 입구를 찾으면 “입구 찾았어”라고 말씀하세요.'}`)
          } else if (currentArrival.reading.proximity !== reading.proximity) {
            updateArrival({ ...currentArrival, reading })
          }
          return
        }
      }
      const next = turns.findIndex(step => step.offset >= progress.offset)
      if (next >= 0 && turns[next].offset - progress.offset <= 40 && next !== lastStep) {
        const spokenDistance = turns[next].offset - progress.offset
        speakOnce(`${spokenDistance < 5 ? '이 지점에서' : meters(spokenDistance) + ' 앞에서'}. ${turns[next].instruction}`)
        if (!recording.current) lastStep = next
      } else if (previous.includes('멈췄어요.')) {
        speakOnce('위치를 다시 확인했어요. 경로 안내를 재개합니다.')
      }
    }
    let stopWatching: (() => void) | undefined
    const resumeWatch = () => {
      stopWatching?.()
      stopWatching = undefined
      if (!document.hidden && !phoneRequested.current) {
        stopWatching = watchNavigationFix(receiveFix, message => speakOnce(`${message} 방향 안내를 잠시 멈췄어요.`))
      }
    }
    resumeWatch()
    document.addEventListener('visibilitychange', resumeWatch)
    window.addEventListener('focus', resumeWatch)
    return () => {
      stopWatching?.()
      document.removeEventListener('visibilitychange', resumeWatch)
      window.removeEventListener('focus', resumeWatch)
    }
  }, [active, speech])

  async function run(action: (signal: AbortSignal) => Promise<void>) {
    pending.current?.abort()
    const request = new AbortController()
    pending.current = request
    setBusy(true)
    try {
      await action(request.signal)
    } catch (error) {
      if (!request.signal.aborted) {
        if (error instanceof GuideLocationError) {
          say(error.message)
        } else if (error instanceof GuideApiError && error.path === '/api/walking-route') {
          say(error.status === 503
            ? '가게는 선택했어요. 도보 안내 서버에 TMAP 키가 설정되지 않아 길 안내를 시작할 수 없어요.'
            : error.status === 404
              ? '가게는 선택했어요. 연결된 서버에 도보 안내 기능이 없어 길 안내를 시작할 수 없어요.'
              : '도보 경로를 불러오지 못했어요. 잠시 뒤 다시 요청해 주세요.')
        } else say('요청을 완료하지 못했어요. 위치 권한과 서버 연결을 확인해 주세요.')
      }
    } finally {
      if (pending.current === request && !request.signal.aborted) setBusy(false)
    }
  }

  function start(option: Option) {
    routeOffer.current = null
    updateArrival(null)
    setActive(option)
    setProposal(null)
    onSelect(option.store)
    say(`${option.store.name}까지 도보 안내를 시작합니다. ${meters(option.route.meters)} 거리예요.`)
  }

  async function findOptions(fix: Fix, search: Query, signal: AbortSignal, current?: Option) {
    const candidates = stores.filter(store => {
      if (!store.coordinates || store.id === current?.store.id) return false
      if (search.category !== '전체' && search.category !== store.category) return false
      const meal = availableMenu(store, search)
      if (search.budget !== null && !meal) return false
      return !search.terms || meal || [store.name, store.address, store.detailCategory].join(' ').includes(search.terms)
    }).sort((a, b) => distanceBetween(fix, a.coordinates!) - distanceBetween(fix, b.coordinates!))
      .slice(0, 6)
    const compared = await Promise.allSettled(candidates.map(async store => ({
      store,
      search,
      route: await post<WalkingRoute>('/api/walking-route', { ...fix, store }, signal),
    })))
    const options = compared.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
    if (candidates.length && !options.length) throw new Error('경로 조회 실패')
    return options.sort((a, b) => a.route.meters - b.route.meters)
  }

  function explainDestination() {
    if (arrivalRef.current) return offerArrivalHelp()
    return say('현재 위치만으로 출입구 도착을 확정할 수 없어요. 가게 근처에 도착하면 전화 도움을 제안할게요.')
  }

  function offerArrivalHelp() {
    routeOffer.current = null
    const current = arrivalRef.current
    const store = current?.store ?? active?.store ?? selected
    if (!store) return say('먼저 안내받을 가게를 선택해 주세요.')
    onActivity?.()
    if (!merchantCallUrl(store.phone)) {
      return say(`${store.name}에 등록된 연결 가능한 전화번호가 없어요. 입구 확인을 도와줄 수 있는 사람에게 도움을 요청해 주세요. 출입구 도착은 아직 확인되지 않았어요.`)
    }
    if (current) updateArrival({ ...current, stage: 'help-offered' })
    else updateArrival({ store, reading: { proximity: 'outside', distance: 0, accuracy: 0 }, stage: 'help-offered' })
    handsFree.requestCommand()
    say(`${store.name}에 전화해서 입구 찾는 도움을 요청할까요? 원하시면 “전화 연결해줘”, 원하지 않으면 “아니요”라고 말씀하세요.`)
  }

  function prepareArrivalCall() {
    const current = arrivalRef.current
    const store = current?.store ?? active?.store ?? selected
    if (!store || !merchantCallUrl(store.phone)) return offerArrivalHelp()
    updateArrival(current ? { ...current, stage: 'call-ready' } : {
      store, reading: { proximity: 'outside', distance: 0, accuracy: 0 }, stage: 'call-ready',
    })
    onActivity?.()
    if (phoneRequested.current) return say('이미 전화 앱 연결을 요청했어요. 기기에서 발신 여부를 확인해 주세요.')
    phoneRequested.current = true
    handsFree.stop('전화 연결을 요청해 마이크 인식을 멈췄어요.')
    const result = requestMerchantCall(store.phone)
    if (result === 'unavailable') {
      phoneRequested.current = false
      if (!voiceManuallyStopped.current) handsFree.start()
    }
    say(result === 'requested'
      ? `${store.name} 번호로 전화 앱 연결을 요청했어요. 기기에 표시되는 발신 확인 절차를 따라 주세요. 전화 앱에서 이 화면으로 돌아오면 다시 들을게요.`
      : '이 기기에서 전화 앱을 열지 못했어요. 전화 연결 버튼으로 다시 요청할 수 있어요.')
  }

  function confirmEntrance() {
    const current = arrivalRef.current
    if (!current) return
    updateArrival({ ...current, stage: 'confirmed' })
    pending.current?.abort()
    setBusy(false)
    setActive(null)
    setProposal(null)
    say('입구를 찾으셨다는 확인을 받았어요. 길 안내를 종료할게요.')
  }

  function handle(command: string) {
    if (!command.trim()) return
    answerRequest.current?.abort()
    lastQuestion.current = command
    if (command === '음성 요청 도움말') {
      return say('불러 주신 건 들었어요. 요청을 이해하지 못했어요. 안내가 끝나면 “여기로 안내” 또는 “근처 식당 찾아줘”라고 다시 말씀해 주세요.')
    }
    command = normalizeVoiceCommand(command)
    if (!command) return say('네, 말씀하세요.')
    conversation.current = [...conversation.current, { role: 'user' as const, text: command }].slice(-8)
    const offered = routeOffer.current
    const consent = spokenConsent(command)
    if (offered && consent) {
      routeOffer.current = null
      if (consent === 'accept') return begin(offered.store, offered.search)
      return say('길 안내는 시작하지 않을게요. 다른 음식이나 조건을 말씀해 주세요.')
    }
    const entryRequest = arrivalCommand(command, arrivalRef.current?.stage === 'help-offered')
    if (entryRequest === 'accept-call') return prepareArrivalCall()
    if (entryRequest === 'help' && (arrivalRef.current || active)) return offerArrivalHelp()
    if (entryRequest === 'confirm' && arrivalRef.current) return confirmEntrance()
    if (entryRequest === 'decline-call' && arrivalRef.current) {
      updateArrival({ ...arrivalRef.current, stage: 'nearby' })
      return say('전화는 연결하지 않을게요. 도움이 필요하면 다시 말씀하세요. 입구를 찾으면 “입구 찾았어”라고 알려 주세요.')
    }

    if (/^(음성\s*모드\s*(꺼|종료)|듣기\s*(종료|그만))[.!\s]*$/.test(command)) {
      routeOffer.current = null
      voiceManuallyStopped.current = true
      handsFree.stop()
      return say('음성 모드를 껐어요.')
    }
    if (/^(안내\s*(종료|그만|취소)|길\s*안내\s*종료)[.!\s]*$/.test(command)) {
      routeOffer.current = null
      pending.current?.abort()
      setBusy(false)
      setActive(null)
      updateArrival(null)
      setProposal(null)
      return say('도보 안내를 종료했어요.')
    }
    if (/^(다시|다시\s*(말해|들려줘)|한번\s*더)[.!\s]*$/.test(command)) {
      if (results.length) return readOption(results, resultIndex)
      return say(status || '무엇을 도와드릴까요?')
    }
    if (/^(다음|다음\s*(가게|거|결과))[.!\s]*$/.test(command)) {
      if (!results.length) return say('먼저 가맹점을 검색해 주세요.')
      if (resultIndex + 1 >= results.length) return say('마지막 후보예요. “첫 번째” 또는 “여기로 안내”라고 말씀하세요.')
      setResultIndex(resultIndex + 1)
      return readOption(results, resultIndex + 1)
    }
    const selection = guideSelection(command)
    if (selection !== null) {
      const index = selection === 'current' ? resultIndex : selection
      const option = results[index]
      if (!option && selection === 'current' && selected) {
        begin(selected)
        return
      }
      if (!option) return say('그 번호의 후보가 없어요. 먼저 가맹점을 검색해 주세요.')
      setResultIndex(index)
      onSelect(option.store)
      begin(option.store, option.search)
      return
    }
    if (/^(감사합니다|감사해요|고마워요?|고맙습니다)[.!\s]*$/.test(command.trim())) {
      pending.current?.abort()
      setBusy(false)
      say('천만에요. 가맹점 검색이나 길 안내가 필요하면 말씀해 주세요.')
      return
    }
    if (!dataReady) {
      waitingCommand.current = command
      say('가맹점 목록을 불러온 뒤 찾아드릴게요.')
      return
    }
    void run(async signal => {
      let intent = localIntent(command)
      try {
        {
          const interpreted = await post<Intent>('/api/guide-intent', {
            text: command,
            hasDestination: Boolean(active),
            hasProposal: Boolean(proposal),
            previousSearch: active?.search ?? query.current,
            facts: facts(),
            selectedName: selected?.name ?? '',
            recommendedName: routeOffer.current?.store.name ?? results[resultIndex]?.store.name ?? '',
            hasRouteOffer: Boolean(routeOffer.current),
            hasCallOffer: arrivalRef.current?.stage === 'help-offered',
            history: conversation.current,
          }, combineVoiceSignals([signal, voiceTimeoutSignal(12000)]))
          if (interpreted.action !== 'yes' && interpreted.action !== 'no') {
            if (interpreted.query && intent.query?.budget != null) {
              interpreted.query.budget = intent.query.budget
            }
            intent = interpreted
            setAiNotice('')
          }
        }
      } catch (error) {
        if (signal.aborted) return
        setAiNotice('대화 AI 응답 재시도가 필요해요.')
        return say(aiFailureMessage(error))
      }
      if (signal.aborted) return
      if (intent.action === 'reply' && intent.reply) return say(intent.reply)
      if (intent.action === 'call') {
        if (arrivalRef.current?.stage === 'help-offered') return prepareArrivalCall()
        return offerArrivalHelp()
      }
      if (intent.action === 'navigate') {
        const terms = intent.query?.terms.trim()
        const matches = terms ? stores.filter(store => store.name.includes(terms)) : []
        const named = terms ? stores.find(store => store.name === terms) ?? (matches.length === 1 ? matches[0] : undefined) : undefined
        if (!named && matches.length > 1) return say(`비슷한 가게가 여러 곳 있어요. ${matches.slice(0, 3).map(store => store.name).join(', ')} 중 어느 가게로 안내할까요?`)
        const target = named ?? (!terms ? routeOffer.current?.store ?? results[resultIndex]?.store ?? selected : undefined)
        if (!target) return say('어느 가게로 안내할까요? 가게 이름을 말씀하시거나 먼저 주변 식당을 찾아 주세요.')
        return begin(target, routeOffer.current?.search ?? query.current)
      }
      if (intent.action === 'sign') return explainDestination()
      if (intent.action === 'no') {
        setProposal(null)
        return say(active ? '현재 목적지로 계속 안내할게요.' : '변경을 취소했어요.')
      }
      if (intent.action === 'yes' && !proposal) return say('아직 변경할 목적지가 없어요.')
      if (['remaining', 'closer'].includes(intent.action) && !active) {
        return say('먼저 가게를 선택하고 도보 안내를 시작해 주세요.')
      }
      if (intent.action === 'search' && intent.query) {
        routeOffer.current = null
        const search = { ...intent.query, budget: intent.query.budget ?? maximumPrice }
        onBudgetSearch(search.budget)
        setProposal(null)
        setResults([])
        query.current = search
        const matches = stores.filter(store => {
          if (search.category !== '전체' && search.category !== store.category) return false
          const meal = availableMenu(store, search)
          if (search.budget !== null && !meal) return false
          return !search.terms || meal || [store.name, store.address, store.detailCategory].join(' ').includes(search.terms)
        })
        if (!matches.length) return say(search.budget === null
          ? '조건에 맞는 가맹점을 찾지 못했어요.'
          : '이 가격에 주문할 수 있다고 등록된 메뉴를 찾지 못했어요.')
        const fix = await requestNavigationFix().catch(() => null)
        if (signal.aborted) return
        const hasLocation = fix && fix.accuracy <= MAX_ACCURACY
        const ranked = hasLocation ? matches.sort((a, b) =>
          (a.coordinates ? distanceBetween(fix, a.coordinates) : Infinity) -
          (b.coordinates ? distanceBetween(fix, b.coordinates) : Infinity),
        ) : matches
        const items = ranked.slice(0, 3).map(store => ({ store, search }))
        setResults(items)
        setResultIndex(0)
        return readOption(items, 0)
      }
      const fix = await requestNavigationFix()
      if (signal.aborted) return
      if (fix.accuracy > MAX_ACCURACY) return say('GPS 위치 오차가 커요. 위치가 정확해지면 다시 요청해 주세요.')
      if (intent.action === 'yes' && proposal) {
        const route = await post<WalkingRoute>('/api/walking-route', { ...fix, store: proposal.store }, signal)
        if (!signal.aborted) start({ ...proposal, route })
        return
      }
      if (intent.action === 'remaining' && active) {
        const position = projectOntoRoute(active.route, fix)
        if (position.gap > Math.max(30, fix.accuracy)) return say('경로를 벗어나 남은 거리를 확인하기 어려워요.')
        return say(`${active.store.name}까지 ${meters(active.route.meters - position.offset)} 남았어요.`)
      }
      if (intent.action === 'closer' && active) {
        const current = await post<WalkingRoute>('/api/walking-route', { ...fix, store: active.store }, signal)
        const options = await findOptions(fix, active.search, signal, active)
        if (signal.aborted) return
        const closer = options.find(option => option.route.meters < current.meters)
        setProposal(closer ?? null)
        return say(closer
          ? `${closer.store.name}까지 ${meters(closer.route.meters)}예요. 이쪽으로 바꿀까요?`
          : '현재 검색 조건에서 더 가까운 가맹점을 찾지 못했어요.')
      }
    })
  }

  const handledRouteRequest = useRef(routeRequest)
  useEffect(() => {
    if (routeRequest === handledRouteRequest.current) return
    handledRouteRequest.current = routeRequest
    if (selected) begin(selected)
  }, [routeRequest, selected])

  function begin(store: Merchant, search: Query = { terms: '', category: store.category, budget: null }) {
    routeOffer.current = null
    say(`${store.name}을 선택했어요. 현재 위치를 확인할게요.`)
    void run(async signal => {
      if (!store.coordinates) return say('가게 위치 좌표가 확인되지 않았어요.')
      const fix = await requestNavigationFix()
      if (signal.aborted) return
      if (fix.accuracy > MAX_ACCURACY) return say('GPS 위치 오차가 커서 지금은 안내를 시작하기 어려워요.')
      const route = await post<WalkingRoute>('/api/walking-route', { ...fix, store }, signal)
      if (!signal.aborted) start({ store, route, search })
    })
  }

  useEffect(() => {
    handsFree.setHandler(command => {
      if (command !== '잇다야') void speech.speak('네, 확인할게요.')
      handle(command)
    })
    if (dataReady && waitingCommand.current) {
      const command = waitingCommand.current
      waitingCommand.current = null
      handle(command)
    }
  })

  async function toggleVoiceMode() {
    if (voiceEnabled) {
      voiceManuallyStopped.current = true
      handsFree.stop()
      say('음성 모드를 껐어요.')
    } else {
      voiceManuallyStopped.current = false
      phoneRequested.current = false
      const started = handsFree.start()
      const ready = await speech.unlock()
      if (ready && started) say('“잇다야”라고 불러 주세요.')
    }
  }

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (event.altKey && event.shiftKey && event.code === 'KeyV') {
        event.preventDefault()
        toggleVoiceMode()
      }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  })

  useEffect(() => {
    // Microphone permission is requested automatically; audio may still need a gesture.
    const prepareSound = () => {
      handsFree.resumeFromGesture()
      if (!speech.isActive()) void speech.unlock()
      document.removeEventListener('pointerdown', prepareSound)
      document.removeEventListener('keydown', prepareSound)
    }
    document.addEventListener('pointerdown', prepareSound)
    document.addEventListener('keydown', prepareSound)
    return () => {
      document.removeEventListener('pointerdown', prepareSound)
      document.removeEventListener('keydown', prepareSound)
    }
  }, [speech, handsFree])

  return <section className="voice-guide" aria-label="음성 길 안내">
    <button id="voice-mode-start" className="voice-mode-toggle" type="button" aria-pressed={voiceEnabled}
      aria-keyshortcuts="Alt+Shift+V"
      aria-describedby="voice-mode-help" onClick={toggleVoiceMode}>{voiceEnabled ? '마이크 끄기' : '마이크 다시 연결'}</button>
    <button type="button" onClick={() => {
      void speech.unlock().then(() => speech.speak('소리 테스트입니다. 이 목소리가 들리면 음성 출력이 준비된 거예요.'))
    }}>소리 테스트</button>
    {playbackStatus && <p role="status">{playbackStatus}</p>}
    {aiNotice && <p role="status">{aiNotice}</p>}
    <div className="voice-audio" ref={node => speech.attach(node)} />
    <p id="voice-mode-help">“잇다야, 근처 식당 찾아줘”라고 말하세요.</p>
    {voiceEnabled && <button type="button" disabled={busy} onClick={() => {
      speech.stop()
      handsFree.requestCommand()
    }}>안내 멈추고 말하기</button>}
    <p role={voiceEnabled ? undefined : 'status'} aria-live={voiceEnabled ? 'off' : 'polite'}>{listeningStatus}</p>
    {heard && <details open className="voice-recognition-detail"><summary>마지막 음성 인식 확인</summary>
      <p>들은 말 · {heard.text || '인식된 문장이 없어요. 마이크 입력을 확인해 주세요.'}</p>
      <p>{heard.accepted ? '요청으로 처리했어요.' : '대화를 시작하려면 “잇다야”라고 불러 주세요.'}</p>
    </details>}
    {!voiceEnabled && <VoiceSearch resultCount={results.length} onRecognized={handle} onRecordingChange={value => {
      recording.current = value
      if (value) speech.stop()
    }} />}
    <form onSubmit={(event: FormEvent) => { event.preventDefault(); handle(text); setText('') }}>
      <input aria-label="가맹점 검색 또는 안내 요청" placeholder="근처에 만 원 이하로 먹을 데 있어?" value={text} onChange={event => setText(event.target.value)} />
      <button type="submit" disabled={busy}>요청</button>
    </form>
    <p role={voiceEnabled ? undefined : 'status'} aria-live={voiceEnabled ? 'off' : 'polite'}>{busy ? '확인 중이에요. ' : ''}{status}</p>
    {speechError && <p role="alert">{speechError}</p>}
    {status && <button type="button" onClick={() => {
      if (!recording.current) void speech.speak(status)
    }}>안내 다시 듣기</button>}
    {!!results.length && <ol aria-label="음성 검색 후보">{results.map(({ store, search }, index) => {
      const meal = availableMenu(store, search)
      return <li key={store.id}><button disabled={busy} aria-current={index === resultIndex ? 'true' : undefined}
        onClick={() => { setResultIndex(index); onSelect(store); begin(store, search) }}>
        {store.name}{meal && ` · ${meal.name} ${meal.price.toLocaleString('ko-KR')}원${meal.preview ? ' (후보 가격)' : ''}`}
      </button></li>
    })}</ol>}
    {arrival && <section className="arrival-assistance" aria-label="가게 도착 확인">
      <h3>{arrival.stage === 'confirmed' ? '입구 확인 완료' : '가게 근처 · 입구 확인'}</h3>
      <p className="arrival-summary">{arrival.store.name}</p>
      {arrival.stage !== 'confirmed' && <>
        <p className="arrival-help-note">{arrival.reading.proximity === 'very-close'
          ? '등록 좌표에서 약 2m 이내 추정 · 출입구는 미확인'
          : arrival.reading.proximity === 'uncertain' ? '위치 오차로 도착 여부 확인 필요'
            : arrival.reading.proximity === 'outside' ? '입구 위치는 확인되지 않았어요.' : '가게 근처로 추정돼요. 출입구는 미확인이에요.'}</p>
        {arrival.stage === 'help-offered' ? <>
          <p>가게에 전화해서 입구 찾는 도움을 요청할까요?</p>
          <div className="arrival-actions"><button type="button" onClick={prepareArrivalCall}>네, 전화 연결</button><button type="button" onClick={() => handle('아니요')}>아니요</button></div>
        </> : <div className="arrival-actions"><button type="button" onClick={confirmEntrance}>입구를 찾았어요</button><button type="button" onClick={offerArrivalHelp}>입구를 모르겠어요</button></div>}
        {arrival.stage === 'call-ready' && merchantCallUrl(arrival.store.phone) && <>
          <a className="arrival-call-link" href={merchantCallUrl(arrival.store.phone)!} onClick={() => { phoneRequested.current=true;handsFree.stop('전화 연결을 요청해 마이크 인식을 멈췄어요.') }} aria-label={`${arrival.store.name}에 전화 연결`}>{arrival.store.name}에 전화 연결 · {arrival.store.phone}</a>
          <p className="arrival-help-note">전화 앱이 열립니다. 실제 통화는 기기에서 확인해 주세요. 전화 연결 요청 중에는 마이크 인식을 멈춥니다.</p>
          <p className="arrival-call-script">{helpCallScript(arrival.store.name)}</p>
          <button type="button" onClick={() => say(helpCallScript(arrival.store.name))}>도움 요청 문장 듣기</button>
          <button type="button" onClick={() => {
            phoneRequested.current = false
            if (!voiceManuallyStopped.current) handsFree.start()
            if (arrivalRef.current) updateArrival({ ...arrivalRef.current, stage: 'nearby' })
            say('음성 안내를 다시 시작했어요. 무엇을 도와드릴까요?')
          }}>통화 후 안내 재개</button>
        </>}
      </>}
    </section>}
    {selected && selected.id !== active?.store.id && <button className="start-selected-route" disabled={busy} onClick={() => begin(selected)}>선택한 가게 도보 안내</button>}
    {active && <button onClick={() => {
      pending.current?.abort()
      setBusy(false)
      setActive(null)
      updateArrival(null)
      setProposal(null)
      say('도보 안내를 종료했어요.')
    }}>안내 종료</button>}
    {proposal && <>
      <button disabled={busy} onClick={() => handle('네')}>목적지 변경</button>
      <button disabled={busy} onClick={() => { setProposal(null); say('현재 목적지로 계속 안내할게요.') }}>계속 안내</button>
    </>}

  </section>
}
