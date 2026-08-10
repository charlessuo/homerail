import { afterEach, describe, expect, it, vi } from 'vitest'
import { installTouchActivation } from './touch-activation'

function pointerEvent(
  type: string,
  init: Partial<PointerEvent> & { pointerId: number },
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  for (const [key, value] of Object.entries({
    pointerType: 'touch',
    isPrimary: true,
    button: 0,
    clientX: 20,
    clientY: 20,
    ...init,
  })) {
    Object.defineProperty(event, key, { configurable: true, value })
  }
  return event
}

describe('touch activation bridge', () => {
  let cleanup: (() => void) | null = null

  afterEach(() => {
    cleanup?.()
    cleanup = null
    document.body.replaceChildren()
    vi.restoreAllMocks()
  })

  it('activates a click-driven button on touch pointer-up exactly once', () => {
    const button = document.createElement('button')
    const onClick = vi.fn()
    button.addEventListener('click', onClick)
    document.body.appendChild(button)
    cleanup = installTouchActivation(document)

    button.dispatchEvent(pointerEvent('pointerdown', { pointerId: 1 }))
    button.dispatchEvent(pointerEvent('pointerup', { pointerId: 1 }))
    expect(onClick).toHaveBeenCalledOnce()

    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('keeps native mouse and keyboard click activation unchanged', () => {
    const button = document.createElement('button')
    const onClick = vi.fn()
    button.addEventListener('click', onClick)
    document.body.appendChild(button)
    cleanup = installTouchActivation(document)

    button.dispatchEvent(pointerEvent('pointerdown', {
      pointerId: 2,
      pointerType: 'mouse',
    }))
    button.dispatchEvent(pointerEvent('pointerup', {
      pointerId: 2,
      pointerType: 'mouse',
    }))
    button.click()

    expect(onClick).toHaveBeenCalledOnce()
  })

  it('does not activate when a touch gesture becomes a scroll', () => {
    const button = document.createElement('button')
    const onClick = vi.fn()
    button.addEventListener('click', onClick)
    document.body.appendChild(button)
    cleanup = installTouchActivation(document)

    button.dispatchEvent(pointerEvent('pointerdown', { pointerId: 3 }))
    button.dispatchEvent(pointerEvent('pointermove', {
      pointerId: 3,
      clientY: 80,
    }))
    button.dispatchEvent(pointerEvent('pointerup', {
      pointerId: 3,
      clientY: 80,
    }))

    expect(onClick).not.toHaveBeenCalled()
  })

  it('supports role buttons and ignores disabled controls', () => {
    const roleButton = document.createElement('div')
    roleButton.setAttribute('role', 'button')
    const disabledButton = document.createElement('button')
    disabledButton.disabled = true
    const onRoleClick = vi.fn()
    const onDisabledClick = vi.fn()
    roleButton.addEventListener('click', onRoleClick)
    disabledButton.addEventListener('click', onDisabledClick)
    document.body.append(roleButton, disabledButton)
    cleanup = installTouchActivation(document)

    roleButton.dispatchEvent(pointerEvent('pointerdown', { pointerId: 4 }))
    roleButton.dispatchEvent(pointerEvent('pointerup', { pointerId: 4 }))
    disabledButton.dispatchEvent(pointerEvent('pointerdown', { pointerId: 5 }))
    disabledButton.dispatchEvent(pointerEvent('pointerup', { pointerId: 5 }))

    expect(onRoleClick).toHaveBeenCalledOnce()
    expect(onDisabledClick).not.toHaveBeenCalled()
  })
})
