/** @version 0.1.0 */

import { describe, expect, it } from "vitest";

import {
  BROWSER_TOOLS_PROTOCOL_VERSION,
  HOMERAIL_UI_TOOL_CONTRACTS,
  browserPageToolDescriptorDigest,
  homeRailUiToolContract,
  uiToolContractDigest,
  validateHomeRailUiToolInput,
} from "./browser-tools.js";

describe("browser tools contracts", () => {
  it("publishes a small stable page-tool catalog", () => {
    expect(BROWSER_TOOLS_PROTOCOL_VERSION).toBe(1);
    expect(HOMERAIL_UI_TOOL_CONTRACTS.map((contract) => contract.name)).toEqual([
      "ui_get_state",
      "ui_open_surface",
      "ui_close_surface",
    ]);
    expect(homeRailUiToolContract("ui_open_surface")?.effect).toBe("presentational");
    expect(homeRailUiToolContract("unknown")).toBeUndefined();
  });

  it("separates trusted contract and page descriptor digests", () => {
    const contract = homeRailUiToolContract("ui_open_surface")!;
    const contractDigest = uiToolContractDigest(contract);
    const descriptorDigest = browserPageToolDescriptorDigest({
      name: contract.name,
      description: contract.description,
      input_schema: contract.input_schema,
      frame_id: "frame-1",
      origin: "https://127.0.0.1:19192",
      navigation_id: "navigation-1",
      read_only: false,
      untrusted_content: true,
    });

    expect(contractDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(descriptorDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(descriptorDigest).not.toBe(contractDigest);
    expect(browserPageToolDescriptorDigest({
      name: contract.name,
      description: contract.description,
      input_schema: contract.input_schema,
      frame_id: "frame-1",
      origin: "https://127.0.0.1:19192",
      navigation_id: "navigation-2",
      read_only: false,
      untrusted_content: true,
    })).not.toBe(descriptorDigest);
  });

  it("freezes the cross-repository first-slice contract digests", () => {
    expect(Object.fromEntries(HOMERAIL_UI_TOOL_CONTRACTS.map((contract) => [
      contract.name,
      uiToolContractDigest(contract),
    ]))).toEqual({
      ui_get_state: "3095c9bbc3d7554cf1fd0475e7de5da70c765fe4acbfad2e607c7c9e63ef44ee",
      ui_open_surface: "783158c38bf647ad841c277295413856b0c7e7f95c9d5a8a139b2e68a001cb7b",
      ui_close_surface: "79fe981d9a5325cdb29aead57672f2add1d101fb8228b5ae942142e4f1416053",
    });
  });

  it("validates and normalizes every frozen tool input", () => {
    expect(validateHomeRailUiToolInput("ui_get_state", {})).toEqual({});
    expect(validateHomeRailUiToolInput("ui_open_surface", {
      surface: " dag_status ",
      entity_id: " run-001 ",
    })).toEqual({ surface: "dag_status", entity_id: "run-001" });
    expect(validateHomeRailUiToolInput("ui_close_surface", {
      surface: "dag_status",
    })).toEqual({ surface: "dag_status" });
  });

  it.each([
    ["ui_get_state", null, /must be an object/],
    ["ui_get_state", { extra: true }, /unsupported field: extra/],
    ["ui_open_surface", { surface: "dag_status", run_id: "run-001" }, /unsupported field: run_id/],
    ["ui_open_surface", { surface: "dag_status", entity_id: 1 }, /entity_id must be a string/],
    ["ui_open_surface", { surface: "dag_status", query: " " }, /1-256 printable/],
    ["ui_open_surface", { surface: "dag_status", entity_id: "run", query: "run" }, /not both/],
    ["ui_close_surface", { surface: "other" }, /requires surface=dag_status/],
  ] as const)("rejects invalid %s input", (name, input, error) => {
    expect(() => validateHomeRailUiToolInput(name, input)).toThrow(error);
  });
});
