import { describe, expect, it } from 'vitest'

import cockpitSource from './AgentVoiceCockpit.vue?raw'

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end, startIndex + start.length)
  if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) {
    throw new Error(`Could not find ordered lifecycle anchors: ${start} -> ${end}`)
  }
  return source.slice(startIndex, endIndex)
}

describe('AgentVoiceCockpit ASR session lifecycle', () => {
  it('starts each utterance with a protocol reset for emulated sessions', () => {
    const beginUtterance = sourceBetween(
      cockpitSource,
      'function beginAsrUtterance(): void',
      'function sendAsrAudio('
    )
    const nativeCapture = sourceBetween(
      cockpitSource,
      'function handleNativeVoiceSamples(',
      'function updateNativeVoiceWaveform('
    )
    const browserCapture = sourceBetween(
      cockpitSource,
      'function updateVoiceWaveform(',
      'async function finishUtterance('
    )

    expect(beginUtterance).toContain('asrDeadlineController.beginUtterance()')
    expect(beginUtterance).toContain(
      'isBatchAsrStrategy(asrDeadlineController.getSessionStrategy())'
    )
    expect(beginUtterance).toContain("asrSocket.send(JSON.stringify({ type: 'start' }))")
    expect(nativeCapture).toContain(
      "if (recognitionMode.value === 'asr') beginAsrUtterance()"
    )
    expect(browserCapture).toContain(
      "if (recognitionMode.value === 'asr') beginAsrUtterance()"
    )
  })

  it('drops events from sockets invalidated by timeout recovery or disconnect', () => {
    const connect = sourceBetween(
      cockpitSource,
      'async function connectAsrRealtime(): Promise<void>',
      'function disconnectAsrRealtime(): void'
    )

    expect(connect).toContain('const socketGeneration = asrSocketGeneration')
    expect(connect).toContain(
      'if (socketGeneration !== asrSocketGeneration || asrSocket !== socket) return'
    )
    expect(connect).toContain('asrDeadlineController.resetSession(disconnectError)')
  })

  it('reconnects after a failed transcription before accepting another utterance', () => {
    const finish = sourceBetween(
      cockpitSource,
      'async function finishUtterance(): Promise<void>',
      'async function connectAsrRealtime(): Promise<void>'
    )
    const recover = sourceBetween(
      cockpitSource,
      'async function recoverAsrRealtimeAfterFailure(token: number): Promise<void>',
      'function beginAsrUtterance(): void'
    )

    expect(finish).toContain('await recoverAsrRealtimeAfterFailure(token)')
    expect(recover).toContain('await connectAsrRealtime()')
    expect(recover).toContain('closeVoiceInputAfterSubmit()')
  })

  it('keeps a healthy ASR socket when a completed transcription is empty', () => {
    const finish = sourceBetween(
      cockpitSource,
      'async function finishUtterance(): Promise<void>',
      'async function connectAsrRealtime(): Promise<void>'
    )
    const asrBranch = sourceBetween(
      finish,
      "if (recognitionMode.value === 'asr') {",
      '\n  const chunks = pcmChunks'
    )
    const emptyTranscriptBranch = sourceBetween(
      asrBranch,
      'if (!text) {',
      '\n      liveTranscript.value = text'
    )
    const failureCatch = sourceBetween(asrBranch, '} catch (err: any) {', '} finally {')

    expect(emptyTranscriptBranch).toContain("error.value = t('voice.errors.noTranscript')")
    expect(emptyTranscriptBranch).toContain('return')
    expect(emptyTranscriptBranch).not.toContain('recoverAsrRealtimeAfterFailure')
    expect(failureCatch).toContain('await recoverAsrRealtimeAfterFailure(token)')
  })
})
