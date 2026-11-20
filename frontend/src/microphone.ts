export function microphoneErrorMessage(error: unknown) {
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return '마이크 사용이 차단됐어요. 휴대폰 설정의 인터넷 앱 마이크 권한과 이 사이트의 마이크 권한을 모두 허용해 주세요.'
  if (name === 'NotReadableError' || name === 'AbortError') return '다른 앱이나 통화가 마이크를 사용 중일 수 있어요. 통화·녹음 앱을 종료한 뒤 마이크를 다시 연결해 주세요.'
  if (name === 'NotFoundError') return '사용 가능한 마이크를 찾지 못했어요. 휴대폰의 마이크 연결을 확인해 주세요.'
  if (name === 'NotSupportedError') return '이 브라우저에서 녹음 형식을 시작하지 못했어요. 인터넷 앱을 업데이트하거나 Chrome에서 열어 주세요.'
  return '마이크 녹음을 시작하지 못했어요. 마이크를 다시 연결해 주세요.'
}

export function microphoneAvailabilityError() {
  if (window.isSecureContext === false) return '휴대폰 마이크는 HTTPS 주소에서 사용할 수 있어요. https로 시작하는 배포 사이트를 열어 주세요.'
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return '이 브라우저에서 마이크 녹음을 사용할 수 없어요. 최신 인터넷 앱이나 Chrome에서 열어 주세요.'
  return null
}

export function createAudioRecorder(stream: MediaStream) {
  const formats = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
  const mimeType = formats.find(type => MediaRecorder.isTypeSupported?.(type))
  return mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
}

export function recordingFileName(type: string) {
  const format = type.split(';')[0].trim().toLowerCase()
  const extension = format === 'audio/mp4' ? 'mp4' : format === 'audio/ogg' ? 'ogg' : format === 'audio/wav' ? 'wav' : 'webm'
  return `command.${extension}`
}
