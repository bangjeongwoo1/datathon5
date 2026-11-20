// 100 ms microphone frames. Accept quieter speech, but ignore a single click.
export const VOICE_RMS_THRESHOLD = 0.0035
export const VOICE_END_SILENCE_FRAMES = 16

export function createVoiceActivity() {
  let consecutive = 0
  let voiced = 0
  let silent = 0
  let frames = 0
  let started = false
  return {
    sample(rms: number) {
      frames++
      const audible = Number.isFinite(rms) && rms >= VOICE_RMS_THRESHOLD
      consecutive = audible ? consecutive + 1 : 0
      const justStarted = !started && consecutive >= 2
      if (justStarted) started = true
      if (started) {
        if (audible) { voiced++; silent = 0 } else silent++
      }
      return {
        justStarted,
        shouldStop: (started && silent >= VOICE_END_SILENCE_FRAMES) || frames >= 150,
        hasSpeech: started && voiced > 0,
      }
    },
  }
}
