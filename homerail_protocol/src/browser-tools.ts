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
  "ui_describe_widget",
  "ui_focus_widget",
  "ui_set_widget_expanded",
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

const stableIdentitySchema = Object.freeze({
  type: "string",
  minLength: 1,
  maxLength: 256,
});

const stableRevisionSchema = Object.freeze({
  type: "integer",
  minimum: 0,
});

const widgetTargetProperties = Object.freeze({
  document_id: stableIdentitySchema,
  document_revision: stableRevisionSchema,
  widget_id: stableIdentitySchema,
  widget_revision: stableRevisionSchema,
});

const widgetTargetRequired = Object.freeze([
  "document_id",
  "document_revision",
  "widget_id",
  "widget_revision",
]);

/**
 * Stable, trusted catalog shared by Manager tools and the page WebMCP adapter.
 * A query is resolved by Manager when invoked by an Agent. The renderer also
 * accepts it for direct same-origin WebMCP use, but still resolves through the
 * authoritative Manager run-list API rather than inspecting labels in the DOM.
 */
export const HOMERAIL_UI_TOOL_CONTRACTS: readonly UiToolContract[] = Object.freeze([
  Object.freeze({
    name: "ui_get_state",
    description: "Read the visible HomeRail surface and a bounded list of trusted widget identities and revisions.",
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
  Object.freeze({
    name: "ui_describe_widget",
    description: "Describe one currently rendered trusted Generative UI widget at an exact document and widget revision.",
    input_schema: Object.freeze({
      type: "object",
      properties: widgetTargetProperties,
      required: widgetTargetRequired,
      additionalProperties: false,
    }),
    effect: "read",
    execution_host: "renderer",
    page_exposure: "webmcp_local",
  }),
  Object.freeze({
    name: "ui_focus_widget",
    description: "Focus and scroll one currently rendered trusted Generative UI widget at an exact document and widget revision.",
    input_schema: Object.freeze({
      type: "object",
      properties: widgetTargetProperties,
      required: widgetTargetRequired,
      additionalProperties: false,
    }),
    effect: "presentational",
    execution_host: "renderer",
    page_exposure: "webmcp_local",
  }),
  Object.freeze({
    name: "ui_set_widget_expanded",
    description: "Set the expanded presentation state of one currently rendered trusted Generative UI widget at an exact revision.",
    input_schema: Object.freeze({
      type: "object",
      properties: Object.freeze({
        ...widgetTargetProperties,
        expanded: Object.freeze({ type: "boolean" }),
      }),
      required: Object.freeze([...widgetTargetRequired, "expanded"]),
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

function browserToolInputRecord(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} input must be an object`);
  }
  return value as Record<string, unknown>;
}

function browserToolInputString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  const normalized = value.trim();
  if (!normalized || normalized.length > 256 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error(`${field} must contain 1-256 printable characters`);
  }
  return normalized;
}

function browserToolInputOpaqueId(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  if (!value.trim() || [...value].length > 256 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${field} must contain 1-256 printable characters`);
  }
  // Generative UI opaque IDs are exact canonical identities. In particular,
  // its frozen schema permits leading and trailing spaces, so normalizing here
  // would merge otherwise distinct documents or widgets.
  return value;
}

function browserToolInputRevision(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
  return value as number;
}

function browserWidgetTargetInput(input: Record<string, unknown>): Record<string, unknown> {
  return {
    document_id: browserToolInputOpaqueId(input.document_id, "document_id"),
    document_revision: browserToolInputRevision(input.document_revision, "document_revision"),
    widget_id: browserToolInputOpaqueId(input.widget_id, "widget_id"),
    widget_revision: browserToolInputRevision(input.widget_revision, "widget_revision"),
  };
}

/**
 * Validate and normalize an invocation against the frozen browser-tools.v1
 * contract. Callers use this at every trusted execution boundary instead of
 * relying on a page implementation or an LLM client to honor JSON Schema.
 */
export function validateHomeRailUiToolInput(
  name: HomeRailUiToolName,
  value: unknown,
): Record<string, unknown> {
  const input = browserToolInputRecord(value, name);
  const allowed = name === "ui_get_state"
    ? new Set<string>()
    : name === "ui_open_surface"
      ? new Set(["surface", "entity_id", "query"])
      : name === "ui_close_surface"
        ? new Set(["surface"])
        : name === "ui_describe_widget" || name === "ui_focus_widget"
          ? new Set(["document_id", "document_revision", "widget_id", "widget_revision"])
          : name === "ui_set_widget_expanded"
            ? new Set(["document_id", "document_revision", "widget_id", "widget_revision", "expanded"])
        : null;
  if (!allowed) throw new Error(`Unknown HomeRail UI tool: ${String(name)}`);

  const unexpected = Object.keys(input).filter((key) => !allowed.has(key)).sort();
  if (unexpected.length) {
    throw new Error(`${name} input contains unsupported field: ${unexpected[0]}`);
  }
  if (name === "ui_get_state") return {};

  if (
    name === "ui_describe_widget"
    || name === "ui_focus_widget"
    || name === "ui_set_widget_expanded"
  ) {
    const target = browserWidgetTargetInput(input);
    if (name !== "ui_set_widget_expanded") return target;
    if (typeof input.expanded !== "boolean") throw new Error("expanded must be a boolean");
    return { ...target, expanded: input.expanded };
  }

  const surface = browserToolInputString(input.surface, "surface");
  if (surface !== "dag_status") throw new Error(`${name} requires surface=dag_status`);
  if (name === "ui_close_surface") return { surface };

  const entityId = input.entity_id === undefined
    ? undefined
    : browserToolInputString(input.entity_id, "entity_id");
  const query = input.query === undefined
    ? undefined
    : browserToolInputString(input.query, "query");
  if (entityId !== undefined && query !== undefined) {
    throw new Error("Provide entity_id or query, not both");
  }
  return {
    surface,
    ...(entityId === undefined ? {} : { entity_id: entityId }),
    ...(query === undefined ? {} : { query }),
  };
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
