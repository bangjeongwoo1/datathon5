// Older Android Internet versions have AbortController without the newer static APIs.
export function voiceTimeoutSignal(milliseconds: number): AbortSignal {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(milliseconds)
  const controller = new AbortController()
  setTimeout(() => controller.abort(new DOMException('Voice request timed out', 'TimeoutError')), milliseconds)
  return controller.signal
}

export function combineVoiceSignals(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(signals)
  const controller = new AbortController()
  const listeners: [AbortSignal, () => void][] = []
  const abort = (signal: AbortSignal) => {
    controller.abort(signal.reason)
    for (const [source, listener] of listeners) source.removeEventListener('abort', listener)
  }
  for (const signal of signals) {
    if (signal.aborted) { abort(signal); break }
    const listener = () => abort(signal)
    listeners.push([signal, listener])
    signal.addEventListener('abort', listener, { once: true })
  }
  return controller.signal
}
