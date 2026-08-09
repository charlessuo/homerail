/**
 * Experimental HomeRail Browser Tools contracts.
 *
 * These contracts are intentionally small and application-owned. WebMCP is an
 * adapter for them; it is never a generic DOM, JavaScript, or CDP authority.
 * @version 0.1.0
 */

import { stableStringify } from "./codec.js";
import { sha256Hex } from "./sha256.js";

export const BROWSER_TOOLS_PROTOCOL_VERSION = 1 as const;
export const BROWSER_TOOLS_MAX_MESSAGE_BYTES = 128 * 1024;
export const BROWSER_TOOLS_MAX_RESULT_BYTES = 64 * 1024;
export const BROWSER_TOOLS_DEFAULT_TIMEOUT_MS = 10_000;

export const HOMERAIL_UI_SURFACES = ["dag_status"] as const;
export type HomeRailUiSurface = (typeof HOMERAIL_UI_SURFACES)[number];

export const HOMERAIL_UI_TOOL_NAMES = [
  "ui_get_state",
  "ui_open_surface",
  "ui_close_surface",
] as const;
export type HomeRailUiToolName = (typeof HOMERAIL_UI_TOOL_NAMES)[number];
export const BROWSER_TOOLS_CAPABILITIES = ["catalog", "act"] as const;
export type BrowserToolsCapability = (typeof BROWSER_TOOLS_CAPABILITIES)[number];

export type UiToolEffect = "read" | "presentational" | "mutating";
export type UiToolExecutionHost = "manager" | "renderer" | "desktop";

export interface UiToolContract {
  name: HomeRailUiToolName;
  description: string;
  input_schema: Record<string, unknown>;
  effect: UiToolEffect;
  execution_host: UiToolExecutionHost;
  page_exposure: "webmcp_local" | "webmcp_proxy" | "none";
}

const emptyObjectSchema = Object.freeze({
  type: "object",
  properties: Object.freeze({}),
  additionalProperties: false,
});

const surfaceSchema = Object.freeze({
  type: "string",
  enum: HOMERAIL_UI_SURFACES,
});

/**
 * Stable, trusted catalog shared by Manager tools and the page WebMCP adapter.
 * A query is resolved by Manager when invoked by an Agent. The renderer also
 * accepts it for direct same-origin WebMCP use, but still resolves through the
 * authoritative Manager run-list API rather than inspecting labels in the DOM.
 */
export const HOMERAIL_UI_TOOL_CONTRACTS: readonly UiToolContract[] = Object.freeze([
  Object.freeze({
    name: "ui_get_state",
    description: "Read the currently visible HomeRail UI surface and its stable target identity.",
    input_schema: emptyObjectSchema,
    effect: "read",
    execution_host: "renderer",
    page_exposure: "webmcp_local",
  }),
  Object.freeze({
    name: "ui_open_surface",
    description: "Open a trusted HomeRail surface directly. For dag_status, provide an exact run id, a unique run query, or neither to open the run list.",
    input_schema: Object.freeze({
      type: "object",
      properties: Object.freeze({
        surface: surfaceSchema,
        entity_id: Object.freeze({ type: "string", minLength: 1, maxLength: 256 }),
        query: Object.freeze({ type: "string", minLength: 1, maxLength: 256 }),
      }),
      required: Object.freeze(["surface"]),
      additionalProperties: false,
    }),
    effect: "presentational",
    execution_host: "renderer",
    page_exposure: "webmcp_local",
  }),
  Object.freeze({
    name: "ui_close_surface",
    description: "Close a trusted HomeRail surface without changing DAG or workspace business state.",
    input_schema: Object.freeze({
      type: "object",
      properties: Object.freeze({ surface: surfaceSchema }),
      required: Object.freeze(["surface"]),
      additionalProperties: false,
    }),
    effect: "presentational",
    execution_host: "renderer",
    page_exposure: "webmcp_local",
  }),
]);

export function homeRailUiToolContract(name: string): UiToolContract | undefined {
  return HOMERAIL_UI_TOOL_CONTRACTS.find((contract) => contract.name === name);
}

export function uiToolContractDigest(contract: UiToolContract): string {
  return sha256Hex(stableStringify({
    name: contract.name,
    description: contract.description,
    input_schema: contract.input_schema,
    effect: contract.effect,
    execution_host: contract.execution_host,
    page_exposure: contract.page_exposure,
  }));
}

export interface BrowserPageToolDescriptor {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  frame_id: string;
  origin: string;
  navigation_id: string;
  read_only: boolean;
  untrusted_content: boolean;
}

export function browserPageToolDescriptorDigest(
  descriptor: BrowserPageToolDescriptor,
): string {
  return sha256Hex(stableStringify(descriptor));
}

export interface BrowserToolsCatalogEntry extends BrowserPageToolDescriptor {
  page_descriptor_digest: string;
  contract_digest?: string;
}

export interface BrowserToolsPageCatalogMessage {
  type: "page.catalog";
  version: typeof BROWSER_TOOLS_PROTOCOL_VERSION;
  page_id: string;
  tools: BrowserToolsCatalogEntry[];
}

export interface BrowserToolsPageInvalidatedMessage {
  type: "page.invalidated";
  version: typeof BROWSER_TOOLS_PROTOCOL_VERSION;
  page_id: string;
  navigation_id?: string;
  reason: "navigation" | "reload" | "debugger_detached" | "feature_disabled" | "window_closed";
}

export interface BrowserToolsInvokeMessage {
  type: "tool.invoke";
  version: typeof BROWSER_TOOLS_PROTOCOL_VERSION;
  call_id: string;
  page_id: string;
  navigation_id: string;
  tool_name: HomeRailUiToolName;
  input: Record<string, unknown>;
  page_descriptor_digest: string;
  contract_digest: string;
  deadline_ms: number;
}

export interface BrowserToolsResultMessage {
  type: "tool.result";
  version: typeof BROWSER_TOOLS_PROTOCOL_VERSION;
  call_id: string;
  ok: boolean;
  output?: unknown;
  error?: string;
}

export interface BrowserToolsAuthChallengeMessage {
  type: "auth.challenge";
  version: typeof BROWSER_TOOLS_PROTOCOL_VERSION;
  server_nonce: string;
  server_proof: string;
}

export interface BrowserToolsAuthResponseMessage {
  type: "auth.response";
  version: typeof BROWSER_TOOLS_PROTOCOL_VERSION;
  client_nonce: string;
  desktop_instance_id: string;
  capabilities: BrowserToolsCapability[];
  client_proof: string;
}

export interface BrowserToolsReadyMessage {
  type: "auth.ready";
  version: typeof BROWSER_TOOLS_PROTOCOL_VERSION;
  connection_id: string;
  capabilities: BrowserToolsCapability[];
}

export type BrowserToolsClientMessage =
  | BrowserToolsAuthResponseMessage
  | BrowserToolsPageCatalogMessage
  | BrowserToolsPageInvalidatedMessage
  | BrowserToolsResultMessage;

export type BrowserToolsManagerMessage =
  | BrowserToolsAuthChallengeMessage
  | BrowserToolsReadyMessage
  | BrowserToolsInvokeMessage;
