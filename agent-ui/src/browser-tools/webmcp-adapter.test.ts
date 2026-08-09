import { describe, expect, it, vi } from 'vitest'

import type { HomeRailUiSurfaceController } from './ui-surface-controller'
import { startHomeRailBrowserTools } from './webmcp-adapter'

function status(enabled: boolean, runtimeEnabled = enabled): DesktopBrowserToolsStatus {
  return {
    supported: true,
    enabled,
    runtimeEnabled,
    restartRequired: enabled && !runtimeEnabled,
    state: enabled ? (runtimeEnabled ? 'connected' : 'restart-required') : 'disabled',
  }
}

describe('WebMCP adapter', () => {
  it('registers the stable catalog only while Desktop enables the runtime', async () => {
    const registrations: Array<{ name: string; signal?: AbortSignal }> = []
    let statusListener: ((next: DesktopBrowserToolsStatus) => void) | undefined
    const modelContext = {
      registerTool: vi.fn(async (tool: { name: string }, options?: { signal?: AbortSignal }) => {
        registrations.push({ name: tool.name, signal: options?.signal })
      }),
    }
    const bridge: HomeRailDesktopBridge = {
      browserToolsStatus: vi.fn(async () => status(true)),
      onBrowserToolsStatus: vi.fn((listener) => {
        statusListener = listener
        return () => { statusListener = undefined }
      }),
    }
    const controller: HomeRailUiSurfaceController = {
      getState: () => ({ active_surface: null, dag_run_id: null, dag_status_view: null }),
      listDagRuns: async () => [],
      openDagStatus: async () => undefined,
      closeDagStatus: () => undefined,
    }

    const stop = await startHomeRailBrowserTools(controller, { bridge, modelContext })
    expect(registrations.map((entry) => entry.name)).toEqual([
      'ui_get_state',
      'ui_open_surface',
      'ui_close_surface',
    ])
    expect(registrations.every((entry) => entry.signal?.aborted === false)).toBe(true)

    statusListener?.(status(false, false))
    expect(registrations.every((entry) => entry.signal?.aborted === true)).toBe(true)
    stop()
  })

  it('does not register when enabling still requires restart', async () => {
    const modelContext = { registerTool: vi.fn(async () => undefined) }
    const bridge: HomeRailDesktopBridge = {
      browserToolsStatus: vi.fn(async () => status(true, false)),
    }
    const controller = {
      getState: () => ({ active_surface: null, dag_run_id: null, dag_status_view: null }),
      listDagRuns: async () => [],
      openDagStatus: async () => undefined,
      closeDagStatus: () => undefined,
    } satisfies HomeRailUiSurfaceController

    const stop = await startHomeRailBrowserTools(controller, { bridge, modelContext })
    expect(modelContext.registerTool).not.toHaveBeenCalled()
    stop()
  })
})
