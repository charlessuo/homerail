import { describe, expect, it, vi } from 'vitest'

import {
  createAgentUiSurfaceController,
  executeHomeRailUiTool,
  resolveDagRunTarget,
  type BrowserToolRunSummary,
  type HomeRailUiSurfaceController,
} from './ui-surface-controller'

const runs: BrowserToolRunSummary[] = [
  { runId: 'run-001', workflowId: 'sync', workflowName: 'Data Sync', status: 'active' },
  { runId: 'run-002', workflowId: 'review', workflowName: 'PR Review', status: 'completed' },
  { runId: 'run-003', workflowId: 'sync-nightly', workflowName: 'Data Sync Nightly', status: 'waiting' },
]

describe('HomeRail UI surface controller', () => {
  it('reports the actual list/graph overlay state instead of a stale current run', () => {
    const store = {
      runtimeOverlayOpen: true,
      runtimeOverlayView: 'run_list',
      runtimeOverlayRunId: null,
      currentRunId: 'previous-run',
      openRuntimeOverlay: vi.fn(),
      closeRuntimeOverlay: vi.fn(),
    }
    const controller = createAgentUiSurfaceController(store as never)
    expect(controller.getState()).toEqual({
      active_surface: 'dag_status',
      dag_run_id: null,
      dag_status_view: 'run_list',
    })

    store.runtimeOverlayView = 'dag_graph'
    store.runtimeOverlayRunId = 'selected-run'
    expect(controller.getState()).toMatchObject({
      dag_run_id: 'selected-run',
      dag_status_view: 'dag_graph',
    })
  })

  it('resolves exact ids and unique semantic queries without guessing', () => {
    expect(resolveDagRunTarget(runs, { entity_id: 'run-002' })).toBe('run-002')
    expect(resolveDagRunTarget(runs, { query: 'PR Review' })).toBe('run-002')
    expect(resolveDagRunTarget(runs, { query: 'nightly' })).toBe('run-003')
    expect(() => resolveDagRunTarget(runs, { query: 'run-00' })).toThrow(/ambiguous/)
    expect(() => resolveDagRunTarget(runs, { query: 'missing' })).toThrow(/No DAG run matches/)
    expect(() => resolveDagRunTarget(runs, { entity_id: 'run-404' })).toThrow(/not found/)
  })

  it('opens and closes the DAG status surface through semantic actions', async () => {
    let active = false
    let selected: string | null = null
    const controller: HomeRailUiSurfaceController = {
      getState: () => ({
        active_surface: active ? 'dag_status' : null,
        dag_run_id: selected,
        dag_status_view: active ? (selected ? 'dag_graph' : 'run_list') : null,
      }),
      listDagRuns: vi.fn(async () => runs),
      openDagStatus: vi.fn(async (runId?: string) => {
        active = true
        selected = runId ?? null
      }),
      closeDagStatus: vi.fn(() => {
        active = false
        selected = null
      }),
    }

    const opened = await executeHomeRailUiTool('ui_open_surface', {
      surface: 'dag_status',
      query: 'PR Review',
    }, controller)
    expect(controller.openDagStatus).toHaveBeenCalledWith('run-002')
    expect(opened).toMatchObject({ ok: true, surface: 'dag_status', dag_run_id: 'run-002' })

    const closed = await executeHomeRailUiTool('ui_close_surface', {
      surface: 'dag_status',
    }, controller)
    expect(controller.closeDagStatus).toHaveBeenCalledOnce()
    expect(closed).toMatchObject({ ok: true, state: { active_surface: null } })
  })
})
