import { HOMERAIL_UI_TOOL_CONTRACTS } from 'homerail-protocol'
import type { HomeRailUiSurfaceController } from './ui-surface-controller'
import { executeHomeRailUiTool } from './ui-surface-controller'

interface WebMcpToolRegistration {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  annotations: {
    readOnlyHint: boolean
    untrustedContentHint: boolean
  }
  execute: (input: Record<string, unknown>) => Promise<string>
}

interface WebMcpModelContext {
  registerTool(
    tool: WebMcpToolRegistration,
    options?: { signal?: AbortSignal },
  ): Promise<void>
}

interface BrowserToolsDocument extends Document {
  modelContext?: WebMcpModelContext
}

export interface BrowserToolsAdapterDependencies {
  bridge?: HomeRailDesktopBridge | null
  modelContext?: WebMcpModelContext | null
}

async function registerTools(
  modelContext: WebMcpModelContext,
  controller: HomeRailUiSurfaceController,
  signal: AbortSignal,
): Promise<void> {
  for (const contract of HOMERAIL_UI_TOOL_CONTRACTS) {
    if (signal.aborted || contract.page_exposure !== 'webmcp_local') return
    await modelContext.registerTool({
      name: contract.name,
      description: contract.description,
      inputSchema: structuredClone(contract.input_schema),
      annotations: {
        readOnlyHint: contract.effect === 'read',
        untrustedContentHint: true,
      },
      async execute(input) {
        const result = await executeHomeRailUiTool(contract.name, input, controller)
        return JSON.stringify(result)
      },
    }, { signal })
  }
}

/**
 * Follow the Desktop-owned feature state and bind the stable HomeRail UI
 * contracts to the experimental page API. Aborting the shared signal removes
 * every registration immediately when the feature is disabled or the view is
 * unmounted.
 */
export async function startHomeRailBrowserTools(
  controller: HomeRailUiSurfaceController,
  dependencies: BrowserToolsAdapterDependencies = {},
): Promise<() => void> {
  const bridge = dependencies.bridge
    ?? (typeof window === 'undefined' ? null : window.homerailDesktop ?? null)
  const modelContext = dependencies.modelContext
    ?? (typeof document === 'undefined' ? null : (document as BrowserToolsDocument).modelContext ?? null)
  let registration: AbortController | null = null
  let generation = 0

  const applyStatus = async (status: DesktopBrowserToolsStatus): Promise<void> => {
    const currentGeneration = ++generation
    if (!status.enabled || !status.runtimeEnabled || !modelContext) {
      registration?.abort()
      registration = null
      return
    }
    if (registration) return
    const next = new AbortController()
    registration = next
    try {
      await registerTools(modelContext, controller, next.signal)
    } catch {
      next.abort()
      if (registration === next) registration = null
      return
    }
    if (currentGeneration !== generation) {
      next.abort()
      if (registration === next) registration = null
    }
  }

  const removeStatusListener = bridge?.onBrowserToolsStatus?.((status) => {
    void applyStatus(status)
  }) ?? null

  try {
    const status = await bridge?.browserToolsStatus?.()
    if (status) await applyStatus(status)
  } catch {
    // Browser-only clients and older Desktop builds remain unchanged.
  }

  return () => {
    generation += 1
    registration?.abort()
    registration = null
    removeStatusListener?.()
  }
}
