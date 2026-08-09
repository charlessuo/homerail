import { http } from '@/api/clients/http-client'
import type { useAgentStore } from '@/stores/agent-store'

export interface BrowserToolRunSummary {
  runId: string
  workflowId?: string
  workflowName?: string
  status: string
}

export interface HomeRailUiState {
  active_surface: 'dag_status' | null
  dag_run_id: string | null
  dag_status_view: 'run_list' | 'dag_graph' | null
}

export interface HomeRailUiSurfaceController {
  getState(): HomeRailUiState
  listDagRuns(): Promise<BrowserToolRunSummary[]>
  openDagStatus(runId?: string): Promise<void>
  closeDagStatus(): void
}

export interface OpenSurfaceInput {
  surface: 'dag_status'
  entity_id?: string
  query?: string
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase()
}

function searchableValues(run: BrowserToolRunSummary): string[] {
  return [run.runId, run.workflowId, run.workflowName]
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    .map(normalized)
}

export function resolveDagRunTarget(
  runs: readonly BrowserToolRunSummary[],
  input: Pick<OpenSurfaceInput, 'entity_id' | 'query'>,
): string | undefined {
  const entityId = input.entity_id?.trim()
  const query = input.query?.trim()
  if (entityId && query) throw new Error('Provide entity_id or query, not both')
  if (!entityId && !query) return undefined

  if (entityId) {
    const exact = runs.find((run) => run.runId === entityId)
    if (!exact) throw new Error(`DAG run not found: ${entityId}`)
    return exact.runId
  }

  const needle = normalized(query!)
  const exact = runs.filter((run) => searchableValues(run).includes(needle))
  if (exact.length === 1) return exact[0].runId
  if (exact.length > 1) {
    throw new Error(`DAG query is ambiguous: ${query}; matches=${exact.map((run) => run.runId).join(',')}`)
  }

  const partial = runs.filter((run) => searchableValues(run).some((value) => value.includes(needle)))
  if (partial.length === 1) return partial[0].runId
  if (partial.length > 1) {
    throw new Error(`DAG query is ambiguous: ${query}; matches=${partial.map((run) => run.runId).join(',')}`)
  }
  throw new Error(`No DAG run matches: ${query}`)
}

function requiredRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Tool input must be an object')
  }
  return value as Record<string, unknown>
}

function optionalBoundedString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`${field} must be a string`)
  const result = value.trim()
  if (!result || result.length > 256 || /[\u0000-\u001f\u007f]/.test(result)) {
    throw new Error(`${field} must contain 1-256 printable characters`)
  }
  return result
}

export async function executeHomeRailUiTool(
  name: string,
  rawInput: unknown,
  controller: HomeRailUiSurfaceController,
): Promise<Record<string, unknown>> {
  const input = requiredRecord(rawInput)
  if (name === 'ui_get_state') {
    if (Object.keys(input).length) throw new Error('ui_get_state does not accept input fields')
    return { ok: true, state: controller.getState() }
  }

  const surface = optionalBoundedString(input.surface, 'surface')
  if (surface !== 'dag_status') throw new Error(`Unsupported UI surface: ${surface ?? '(missing)'}`)

  if (name === 'ui_open_surface') {
    const entityId = optionalBoundedString(input.entity_id, 'entity_id')
    const query = optionalBoundedString(input.query, 'query')
    const runId = resolveDagRunTarget(await controller.listDagRuns(), {
      entity_id: entityId,
      query,
    })
    await controller.openDagStatus(runId)
    return {
      ok: true,
      surface,
      dag_run_id: runId ?? null,
      state: controller.getState(),
    }
  }

  if (name === 'ui_close_surface') {
    if (input.entity_id !== undefined || input.query !== undefined) {
      throw new Error('ui_close_surface accepts only surface')
    }
    controller.closeDagStatus()
    return { ok: true, surface, state: controller.getState() }
  }

  throw new Error(`Unknown HomeRail UI tool: ${name}`)
}

export function createAgentUiSurfaceController(
  store: ReturnType<typeof useAgentStore>,
): HomeRailUiSurfaceController {
  return {
    getState: () => ({
      active_surface: store.runtimeOverlayOpen ? 'dag_status' : null,
      dag_run_id: store.runtimeOverlayOpen && store.runtimeOverlayView === 'dag_graph'
        ? store.runtimeOverlayRunId ?? store.currentRunId
        : null,
      dag_status_view: store.runtimeOverlayOpen ? store.runtimeOverlayView : null,
    }),
    async listDagRuns() {
      const response = await http.get<{ runs?: BrowserToolRunSummary[] }>('/api/runs')
      return Array.isArray(response.data?.runs) ? response.data.runs : []
    },
    openDagStatus: (runId) => store.openRuntimeOverlay(runId),
    closeDagStatus: () => store.closeRuntimeOverlay(),
  }
}
