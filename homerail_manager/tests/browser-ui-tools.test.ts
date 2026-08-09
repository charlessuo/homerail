import { createServer, request, type Server } from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PersistedRunSummary } from "../src/persistence/store.js";
import {
  browserUiToolRoutesHandler,
  resolveBrowserUiDagRun,
} from "../src/server/browser-ui-tools.js";

let server: Server | null = null;

afterEach(async () => {
  if (!server?.listening) return;
  server.close();
  await once(server, "close");
  server = null;
});

async function routeRequest(input: {
  authorize: boolean;
  body: Record<string, unknown>;
  invoke?: (name: "ui_get_state", value: unknown) => Promise<unknown>;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  server = createServer((req, res) => {
    browserUiToolRoutesHandler(req, res, {
      authorize: () => input.authorize,
      invoke: input.invoke as never,
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing test server address");
  return new Promise((resolve, reject) => {
    const req = request({
      host: "127.0.0.1",
      port: address.port,
      path: "/api/browser-tools/invoke",
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      res.on("end", () => resolve({
        status: res.statusCode ?? 0,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>,
      }));
    });
    req.once("error", reject);
    req.end(JSON.stringify(input.body));
  });
}

const runs: PersistedRunSummary[] = [
  { runId: "run-001", workflowId: "sync", workflowName: "Data Sync", status: "active", createdAt: 3 },
  { runId: "run-002", workflowId: "review", workflowName: "PR Review", status: "completed", createdAt: 2 },
  { runId: "run-003", workflowId: "sync-nightly", workflowName: "Data Sync Nightly", status: "waiting", createdAt: 1 },
];

describe("Manager browser UI target resolution", () => {
  it("resolves exact ids and unique names and rejects ambiguity", () => {
    expect(resolveBrowserUiDagRun(runs, { entity_id: "run-002" })).toBe("run-002");
    expect(resolveBrowserUiDagRun(runs, { query: "PR Review" })).toBe("run-002");
    expect(resolveBrowserUiDagRun(runs, { query: "nightly" })).toBe("run-003");
    expect(resolveBrowserUiDagRun(runs, {})).toBeUndefined();
    expect(() => resolveBrowserUiDagRun(runs, { query: "run-00" })).toThrow(/ambiguous/);
    expect(() => resolveBrowserUiDagRun(runs, { query: "missing" })).toThrow(/No DAG run matches/);
    expect(() => resolveBrowserUiDagRun(runs, { entity_id: "run-404" })).toThrow(/not found/);
  });

  it("requires a Manager turn and invokes the same trusted broker callback", async () => {
    await expect(routeRequest({
      authorize: false,
      body: { name: "ui_get_state", input: {} },
    })).resolves.toMatchObject({ status: 403 });

    const invoke = vi.fn(async () => ({ ok: true, state: { active_surface: null } }));
    const response = await routeRequest({
      authorize: true,
      body: { name: "ui_get_state", input: {} },
      invoke,
    });
    expect(response).toMatchObject({
      status: 200,
      body: { success: true, data: { result: { ok: true } } },
    });
    expect(invoke).toHaveBeenCalledWith("ui_get_state", {});
  });

  it("rejects schema-invalid input at the HTTP boundary before invoking the broker", async () => {
    const invoke = vi.fn(async () => ({ ok: true }));
    const response = await routeRequest({
      authorize: true,
      body: {
        name: "ui_open_surface",
        input: { surface: "dag_status", run_id: "run-001" },
      },
      invoke: invoke as never,
    });

    expect(response).toMatchObject({
      status: 400,
      body: { success: false },
    });
    expect(String(response.body.error)).toContain("unsupported field: run_id");
    expect(invoke).not.toHaveBeenCalled();
  });
});
