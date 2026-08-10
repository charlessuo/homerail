import { afterEach, describe, expect, it, vi } from 'vitest'
import { installTouchActivation } from './touch-activation'

const TAP_X = 20
const TAP_Y = 20

function pointerEvent(
  type: string,
  init: Partial<PointerEvent> & { pointerId: number },
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  for (const [key, value] of Object.entries({
    pointerType: 'touch',
    isPrimary: true,
    button: 0,
    clientX: TAP_X,
    clientY: TAP_Y,
    ...init,
  })) {
    Object.defineProperty(event, key, { configurable: true, value })
  }
  return event
}

// The browser fires its touch compatibility click at the touch coordinates, so
// tests that emulate it must pass those coordinates. A MouseEvent built with no
// init has clientX/clientY === 0, which on a real device only happens for
// keyboard / assistive-tech / programmatic activation — none of which are the
// compatibility click and none of which this bridge may suppress.
function compatClick(x: number = TAP_X, y: number = TAP_Y): MouseEvent {
  return new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y })
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

    button.dispatchEvent(compatClick())
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

  it('does not swallow a non-compatibility activation of the same control within the suppression window', () => {
    // Regression for the prior target-identity matcher: if the browser never
    // emits a compatibility click for the tap (e.g. an upstream handler
    // preventDefaults touchstart), the bridge must leave genuine activations
    // — keyboard Enter/Space, programmatic el.click(), assistive-tech — intact.
    const button = document.createElement('button')
    const onClick = vi.fn()
    button.addEventListener('click', onClick)
    document.body.appendChild(button)
    cleanup = installTouchActivation(document)

    button.dispatchEvent(pointerEvent('pointerdown', { pointerId: 6 }))
    button.dispatchEvent(pointerEvent('pointerup', { pointerId: 6 }))
    expect(onClick).toHaveBeenCalledOnce()

    // No compat click was emitted yet, so the suppression is still armed when
    // a keyboard-style activation (clientX/clientY === 0) arrives. It must run.
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(onClick).toHaveBeenCalledTimes(2)
  })

  it('suppresses each compatibility click independently for concurrent multi-touch taps', () => {
    // Regression for the single-slot pendingNativeClick: two simultaneous taps
    // on different controls must not let one tap overwrite the other's pending
    // suppression, which previously caused one control's handler to fire twice.
    const buttonA = document.createElement('button')
    const buttonB = document.createElement('button')
    const onClickA = vi.fn()
    const onClickB = vi.fn()
    buttonA.addEventListener('click', onClickA)
    buttonB.addEventListener('click', onClickB)
    document.body.append(buttonA, buttonB)
    cleanup = installTouchActivation(document)

    buttonA.dispatchEvent(pointerEvent('pointerdown', { pointerId: 7, clientX: 10, clientY: 10 }))
    buttonB.dispatchEvent(pointerEvent('pointerdown', { pointerId: 8, clientX: 90, clientY: 90 }))
    buttonA.dispatchEvent(pointerEvent('pointerup', { pointerId: 7, clientX: 10, clientY: 10 }))
    buttonB.dispatchEvent(pointerEvent('pointerup', { pointerId: 8, clientX: 90, clientY: 90 }))
    expect(onClickA).toHaveBeenCalledOnce()
    expect(onClickB).toHaveBeenCalledOnce()

    // Both delayed compatibility clicks arrive; each must be matched to its own
    // tap location and suppressed, so neither handler runs a second time.
    buttonA.dispatchEvent(compatClick(10, 10))
    buttonB.dispatchEvent(compatClick(90, 90))
    expect(onClickA).toHaveBeenCalledOnce()
    expect(onClickB).toHaveBeenCalledOnce()
  })

  it('suppresses a compatibility click retargeted to a different element after a DOM mutation', () => {
    // Regression for the ghost-click window: the synthetic click may mutate the
    // DOM under the tap point (open a popover, close the fullscreen gate), so
    // the browser can retarget the delayed compatibility click onto a different
    // element at the same coordinates. Matching by location — not target
    // identity — ensures it is still suppressed.
    const button = document.createElement('button')
    const onButtonClick = vi.fn()
    button.addEventListener('click', onButtonClick)
    document.body.appendChild(button)
    const laterSibling = document.createElement('a')
    laterSibling.setAttribute('href', '#')
    const onSiblingClick = vi.fn()
    laterSibling.addEventListener('click', onSiblingClick)
    document.body.appendChild(laterSibling)
    cleanup = installTouchActivation(document)

    button.dispatchEvent(pointerEvent('pointerdown', { pointerId: 9 }))
    button.dispatchEvent(pointerEvent('pointerup', { pointerId: 9 }))
    expect(onButtonClick).toHaveBeenCalledOnce()

    // The compatibility click lands at the original tap coordinates but on a
    // freshly rendered sibling element. It is the same physical tap, so it must
    // not cause a second navigation/activation.
    laterSibling.dispatchEvent(compatClick(TAP_X, TAP_Y))
    expect(onSiblingClick).not.toHaveBeenCalled()
  })
})
