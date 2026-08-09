import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { i18n } from '@/plugins/i18n'
import BrowserToolsSettings from './BrowserToolsSettings.vue'

function browserToolsStatus(
  overrides: Partial<DesktopBrowserToolsStatus> = {},
): DesktopBrowserToolsStatus {
  return {
    supported: true,
    enabled: false,
    runtimeEnabled: false,
    restartRequired: false,
    state: 'disabled',
    ...overrides,
  }
}

async function flushUi(): Promise<void> {
  await Promise.resolve()
  await nextTick()
}

describe('BrowserToolsSettings', () => {
  let app: App<Element> | null = null
  let root: HTMLElement | null = null

  beforeEach(() => {
    i18n.global.locale.value = 'zh-Hans'
  })

  afterEach(() => {
    app?.unmount()
    root?.remove()
    app = null
    root = null
    Reflect.deleteProperty(window, 'homerailDesktop')
    vi.restoreAllMocks()
  })

  function mount(bridge: HomeRailDesktopBridge): void {
    Object.defineProperty(window, 'homerailDesktop', {
      configurable: true,
      value: bridge,
    })
    root = document.createElement('div')
    document.body.appendChild(root)
    app = createApp(BrowserToolsSettings)
    app.use(i18n)
    app.mount(root)
  }

  it('is hidden outside Desktop and defaults to off in Desktop', async () => {
    mount({})
    await flushUi()
    expect(root?.querySelector('[data-testid="desktop-browser-tools-settings"]')).toBeNull()

    app?.unmount()
    root!.innerHTML = ''
    mount({
      browserToolsStatus: vi.fn().mockResolvedValue(browserToolsStatus()),
      setBrowserToolsEnabled: vi.fn(),
    })
    await flushUi()
    expect(root?.querySelector('[data-testid="desktop-browser-tools-toggle"]')?.getAttribute('aria-checked'))
      .toBe('false')
  })

  it('enables through Desktop and explains the required first restart', async () => {
    const setBrowserToolsEnabled = vi.fn().mockResolvedValue(browserToolsStatus({
      enabled: true,
      restartRequired: true,
      state: 'restart-required',
    }))
    mount({
      browserToolsStatus: vi.fn().mockResolvedValue(browserToolsStatus()),
      setBrowserToolsEnabled,
    })
    await flushUi()

    root?.querySelector<HTMLButtonElement>('[data-testid="desktop-browser-tools-toggle"]')?.click()
    await flushUi()

    expect(setBrowserToolsEnabled).toHaveBeenCalledWith(true)
    expect(root?.querySelector('[data-testid="desktop-browser-tools-toggle"]')?.getAttribute('aria-checked'))
      .toBe('true')
    expect(root?.querySelector('[data-testid="desktop-browser-tools-state"]')?.textContent)
      .toContain('重启一次 HomeRail Desktop')
  })

  it('reflects an immediate disable update from Desktop', async () => {
    let statusListener: ((status: DesktopBrowserToolsStatus) => void) | undefined
    mount({
      browserToolsStatus: vi.fn().mockResolvedValue(browserToolsStatus({
        enabled: true,
        runtimeEnabled: true,
        state: 'connected',
      })),
      setBrowserToolsEnabled: vi.fn(),
      onBrowserToolsStatus: vi.fn((listener) => {
        statusListener = listener
        return () => undefined
      }),
    })
    await flushUi()

    statusListener?.(browserToolsStatus())
    await flushUi()

    expect(root?.querySelector('[data-testid="desktop-browser-tools-toggle"]')?.getAttribute('aria-checked'))
      .toBe('false')
    expect(root?.querySelector('[data-testid="desktop-browser-tools-state"]')?.textContent)
      .toContain('没有注册或连接任何页面工具')
  })
})
