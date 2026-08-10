const ACTIVATABLE_SELECTOR = [
  'button',
  'a[href]',
  '[role="button"]',
  'input[type="button"]',
  'input[type="submit"]',
  'input[type="reset"]',
  'summary',
].join(',')

const MAX_TAP_DISTANCE_PX = 12
const MAX_TAP_DURATION_MS = 800
const SYNTHETIC_CLICK_WINDOW_MS = 750

interface ActiveTouchPointer {
  target: HTMLElement
  startX: number
  startY: number
  startedAt: number
}

interface PendingNativeClick {
  target: HTMLElement
  expiresAt: number
}

function isTouchPointer(event: PointerEvent): boolean {
  return event.pointerType === 'touch' || event.pointerType === 'pen'
}

function resolveActivatable(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null
  const activatable = target.closest<HTMLElement>(ACTIVATABLE_SELECTOR)
  if (!activatable || !activatable.isConnected) return null
  if (
    activatable.matches(':disabled') ||
    activatable.getAttribute('aria-disabled') === 'true' ||
    activatable.hasAttribute('inert') ||
    activatable.closest('[inert]')
  ) {
    return null
  }
  return activatable
}

function pointerTravelledTooFar(
  pointer: ActiveTouchPointer,
  event: PointerEvent,
): boolean {
  return Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) > MAX_TAP_DISTANCE_PX
}

/**
 * Makes the app's existing click-driven controls respond directly to touch and
 * pen pointer-up events. The browser-generated compatibility click is then
 * suppressed so Vue handlers still run exactly once. Mouse clicks and keyboard
 * activation continue through the browser's native click path.
 */
export function installTouchActivation(root: Document | HTMLElement = document): () => void {
  const activePointers = new Map<number, ActiveTouchPointer>()
  let pendingNativeClick: PendingNativeClick | null = null
  let dispatchingSyntheticClick = false

  const onPointerDown = (event: PointerEvent) => {
    if (!isTouchPointer(event) || !event.isPrimary || event.button !== 0) return
    const target = resolveActivatable(event.target)
    if (!target) return
    activePointers.set(event.pointerId, {
      target,
      startX: event.clientX,
      startY: event.clientY,
      startedAt: performance.now(),
    })
  }

  const onPointerMove = (event: PointerEvent) => {
    const pointer = activePointers.get(event.pointerId)
    if (pointer && pointerTravelledTooFar(pointer, event)) {
      activePointers.delete(event.pointerId)
    }
  }

  const onPointerCancel = (event: PointerEvent) => {
    activePointers.delete(event.pointerId)
  }

  const onPointerUp = (event: PointerEvent) => {
    const pointer = activePointers.get(event.pointerId)
    activePointers.delete(event.pointerId)
    if (!pointer || pointerTravelledTooFar(pointer, event)) return
    if (performance.now() - pointer.startedAt > MAX_TAP_DURATION_MS) return

    const target = resolveActivatable(event.target)
    if (!target || target !== pointer.target) return

    pendingNativeClick = {
      target,
      expiresAt: performance.now() + SYNTHETIC_CLICK_WINDOW_MS,
    }
    dispatchingSyntheticClick = true
    try {
      target.click()
    } finally {
      dispatchingSyntheticClick = false
    }
  }

  const onClick = (event: MouseEvent) => {
    if (dispatchingSyntheticClick || !pendingNativeClick) return
    const target = resolveActivatable(event.target)
    if (
      performance.now() <= pendingNativeClick.expiresAt &&
      target === pendingNativeClick.target
    ) {
      pendingNativeClick = null
      event.preventDefault()
      event.stopImmediatePropagation()
      return
    }
    pendingNativeClick = null
  }

  root.addEventListener('pointerdown', onPointerDown as EventListener, true)
  root.addEventListener('pointermove', onPointerMove as EventListener, true)
  root.addEventListener('pointercancel', onPointerCancel as EventListener, true)
  root.addEventListener('pointerup', onPointerUp as EventListener, true)
  root.addEventListener('click', onClick as EventListener, true)

  return () => {
    root.removeEventListener('pointerdown', onPointerDown as EventListener, true)
    root.removeEventListener('pointermove', onPointerMove as EventListener, true)
    root.removeEventListener('pointercancel', onPointerCancel as EventListener, true)
    root.removeEventListener('pointerup', onPointerUp as EventListener, true)
    root.removeEventListener('click', onClick as EventListener, true)
    activePointers.clear()
    pendingNativeClick = null
  }
}
