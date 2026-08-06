import { describe, expect, it } from 'vitest'

import cockpitSource from './AgentVoiceCockpit.vue?raw'

function sourceBetween(start: string, end: string): string {
  return cockpitSource.slice(cockpitSource.indexOf(start), cockpitSource.indexOf(end))
}

describe('AgentVoiceCockpit ASR session lifecycle', () => {
  it('starts each utterance with a protocol reset for emulated sessions', () => {
    const beginUtterance = sourceBetween(
      'function beginAsrUtterance(): void',
      'function sendAsrAudio('
    )

    expect(beginUtterance).toContain('asrDeadlineController.beginUtterance()')
    expect(beginUtterance).toContain(
      'isBatchAsrStrategy(asrDeadlineController.getSessionStrategy())'
    )
    expect(beginUtterance).toContain("asrSocket.send(JSON.stringify({ type: 'start' }))")
    expect(cockpitSource.match(/beginAsrUtterance\(\)/g)).toHaveLength(3)
  })

  it('drops events from sockets invalidated by timeout recovery or disconnect', () => {
    const connect = sourceBetween(
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
      'async function finishUtterance(): Promise<void>',
      'async function connectAsrRealtime(): Promise<void>'
    )
    const recover = sourceBetween(
      'async function recoverAsrRealtimeAfterFailure(token: number): Promise<void>',
      'function beginAsrUtterance(): void'
    )

    expect(finish).toContain('await recoverAsrRealtimeAfterFailure(token)')
    expect(recover).toContain('await connectAsrRealtime()')
    expect(recover).toContain('closeVoiceInputAfterSubmit()')
  })
})
