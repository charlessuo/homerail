import { execFile } from "node:child_process";
import {
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

const helperModuleUrl = new URL("../../scripts/configure-apt-sources.mjs", import.meta.url);
const helperScriptPath = fileURLToPath(helperModuleUrl);
const workerRoot = fileURLToPath(new URL("../..", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const dockerfile = readFileSync(new URL("../../Dockerfile", import.meta.url), "utf8")
  .replace(/\r\n/g, "\n");

interface BuildSourcesHelperModule {
  DEFAULT_DEB822_SOURCES_PATH: string;
  APT_MAIN_MIRROR_ENV: string;
  APT_SECURITY_MIRROR_ENV: string;
  normalizeMirrorValue: (rawValue: unknown) => string | undefined;
  validateMirrorUrl: (rawValue: string, key: string) => string;
  applyDeb822SourceOverrides: (
    content: string,
    overrides?: { mainMirror?: string; securityMirror?: string },
  ) => { output: string; changed: boolean };
  runCli: (options?: {
    argv?: string[];
    env?: Record<string, string | undefined>;
    readFile?: (sourcesPath: string) => string;
    writeFile?: (sourcesPath: string, output: string) => void;
    fail?: (message: string) => void;
  }) => number;
}

const helper = (await import(helperModuleUrl.href)) as BuildSourcesHelperModule;

const DEBIAN_SOURCES_FIXTURE = [
  "Types: deb",
  "URIs: http://deb.debian.org/debian",
  "Suites: bookworm bookworm-updates",
  "Components: main",
  "Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg",
  "",
  "Types: deb",
  "URIs: http://deb.debian.org/debian-security",
  "Suites: bookworm-security",
  "Components: main",
  "Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg",
  "",
].join("\n");

const MAIN_STANZA_SECURITY_BY = "Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg";

function dockerfileStages(): { header: string; lines: string[] }[] {
  const chunks = dockerfile.split(/^FROM /m).slice(1);
  return chunks.map((chunk) => {
    const [header, ...rest] = chunk.split("\n");
    return { header: header ?? "", lines: rest };
  });
}

interface DockerRunInstruction {
  lineIndex: number;
  text: string;
}

function runInstructions(lines: string[]): DockerRunInstruction[] {
  const instructions: DockerRunInstruction[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^RUN(\s|$)/.test(lines[index])) continue;
    const parts: string[] = [];
    let cursor = index;
    while (cursor < lines.length) {
      const line = lines[cursor];
      const continued = line.endsWith("\\");
      parts.push(continued ? line.slice(0, -1) : line);
      if (!continued) break;
      cursor += 1;
    }
    instructions.push({ lineIndex: index, text: parts.join(" ") });
  }
  return instructions;
}

function npmInstructions(lines: string[]): DockerRunInstruction[] {
  return runInstructions(lines).filter((instruction) => /(^|[\s&|;(])npm([\s@]|$)/.test(instruction.text));
}

const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("Worker deb822 source override helper", () => {
  it("treats unset and whitespace-only values as unconfigured", () => {
    expect(helper.normalizeMirrorValue(undefined)).toBeUndefined();
    expect(helper.normalizeMirrorValue("")).toBeUndefined();
    expect(helper.normalizeMirrorValue("   \t ")).toBeUndefined();
    expect(helper.normalizeMirrorValue(" https://mirror.example.com/debian "))
      .toBe("https://mirror.example.com/debian");

    for (const overrides of [
      {},
      { mainMirror: "", securityMirror: "   " },
      undefined,
    ]) {
      const result = helper.applyDeb822SourceOverrides(DEBIAN_SOURCES_FIXTURE, overrides);
      expect(result.changed).toBe(false);
      expect(result.output).toBe(DEBIAN_SOURCES_FIXTURE);
    }
  });

  it("replaces the main stanza without touching the security stanza", () => {
    const result = helper.applyDeb822SourceOverrides(DEBIAN_SOURCES_FIXTURE, {
      mainMirror: "https://mirror.example.com/debian",
    });
    expect(result.changed).toBe(true);
    expect(result.output).toContain("URIs: https://mirror.example.com/debian\nSuites: bookworm bookworm-updates");
    expect(result.output).toContain("URIs: http://deb.debian.org/debian-security");
  });

  it("replaces the security stanza without touching the main stanza", () => {
    const result = helper.applyDeb822SourceOverrides(DEBIAN_SOURCES_FIXTURE, {
      securityMirror: "https://mirror.example.com/debian-security",
    });
    expect(result.changed).toBe(true);
    expect(result.output).toContain("URIs: https://mirror.example.com/debian-security\nSuites: bookworm-security");
    expect(result.output).toContain("URIs: http://deb.debian.org/debian\nSuites: bookworm bookworm-updates");
  });

  it("replaces both stanzas when both overrides are configured", () => {
    const result = helper.applyDeb822SourceOverrides(DEBIAN_SOURCES_FIXTURE, {
      mainMirror: "https://mirror.example.com/debian",
      securityMirror: "https://mirror.example.com/debian-security",
    });
    expect(result.changed).toBe(true);
    expect(result.output).not.toContain("deb.debian.org");
    expect(result.output).toContain("URIs: https://mirror.example.com/debian");
    expect(result.output).toContain("URIs: https://mirror.example.com/debian-security");
  });

  it("normalizes harmless trailing slash differences consistently", () => {
    const plain = helper.applyDeb822SourceOverrides(DEBIAN_SOURCES_FIXTURE, {
      mainMirror: "https://mirror.example.com/debian",
    });
    const slashed = helper.applyDeb822SourceOverrides(DEBIAN_SOURCES_FIXTURE, {
      mainMirror: "https://mirror.example.com/debian///",
    });
    expect(slashed.output).toBe(plain.output);
    expect(helper.validateMirrorUrl("https://mirror.example.com/debian/", helper.APT_MAIN_MIRROR_ENV))
      .toBe("https://mirror.example.com/debian");
  });

  it("preserves unrelated deb822 fields and stanza structure", () => {
    const result = helper.applyDeb822SourceOverrides(DEBIAN_SOURCES_FIXTURE, {
      mainMirror: "https://mirror.example.com/debian",
    });
    const expected = DEBIAN_SOURCES_FIXTURE.replace(
      "URIs: http://deb.debian.org/debian\n",
      "URIs: https://mirror.example.com/debian\n",
    );
    expect(result.output).toBe(expected);
    expect(result.output.match(/Signed-By: /g)).toHaveLength(2);
    expect(result.output).toContain(MAIN_STANZA_SECURITY_BY);
    expect(result.output.endsWith("\n")).toBe(true);
  });

  it("keeps a stanza untouched when only the other override is configured", () => {
    const securityOnly = helper.applyDeb822SourceOverrides(DEBIAN_SOURCES_FIXTURE, {
      securityMirror: "https://mirror.example.com/debian-security",
    });
    expect(securityOnly.output).toContain("URIs: http://deb.debian.org/debian\n");
  });

  it("fails when an override is requested but the deb822 input is malformed", () => {
    const malformedInputs = [
      "",
      "   \n",
      "garbage line without a field\n",
      " continuation without a field\n",
      "Types: deb\nSuites: bookworm\nComponents: main\n",
      "Types: deb\nURIs: http://deb.debian.org/debian\nURIs: http://other.example.com/debian\nSuites: bookworm\n",
      "Types: deb\nURIs: http://deb.debian.org/debian\n",
    ];
    for (const content of malformedInputs) {
      expect(() => helper.applyDeb822SourceOverrides(content, {
        mainMirror: "https://mirror.example.com/debian",
      })).toThrow(/Malformed deb822 sources/);
      expect(() => helper.applyDeb822SourceOverrides(content, {
        securityMirror: "https://mirror.example.com/debian-security",
      })).toThrow(/Malformed deb822 sources/);
    }
  });

  it("rejects invalid mirror URLs naming the configuration key but not the value", () => {
    const invalidValues = [
      "ftp://mirror.example.com/debian",
      "not a url",
      "https://user:password@mirror.example.com/debian",
      "https://mirror.example.com/debian?component=main",
      "https://mirror.example.com/debian#fragment",
      "https://mirror.example.com/deb ian",
      "https://mirror.example.com/debian\u0000",
      "file:///etc/passwd",
    ];
    for (const value of invalidValues) {
      let caught: unknown;
      try {
        helper.applyDeb822SourceOverrides(DEBIAN_SOURCES_FIXTURE, { mainMirror: value });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      const message = (caught as Error).message;
      expect(message).toContain(helper.APT_MAIN_MIRROR_ENV);
      expect(message).not.toContain(value);
      expect(() => helper.validateMirrorUrl(value, helper.APT_SECURITY_MIRROR_ENV))
        .toThrow(helper.APT_SECURITY_MIRROR_ENV);
    }
  });

  it("runs entirely in-process through runCli when nothing is configured", () => {
    let written = false;
    const exitCode = helper.runCli({
      argv: [],
      env: {},
      readFile: () => {
        throw new Error("helper must not read sources when unconfigured");
      },
      writeFile: () => {
        written = true;
      },
    });
    expect(exitCode).toBe(0);
    expect(written).toBe(false);
  });
});

describe("Worker deb822 source override CLI", () => {
  function makeSourcesFile(content: string): string {
    const dir = mkdtempSync(join(tmpdir(), "homerail-worker-apt-sources-"));
    tempDirs.push(dir);
    const sourcesPath = join(dir, "debian.sources");
    writeFileSync(sourcesPath, content, "utf8");
    return sourcesPath;
  }

  function cliEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env[helper.APT_MAIN_MIRROR_ENV];
    delete env[helper.APT_SECURITY_MIRROR_ENV];
    return { ...env, ...overrides };
  }

  it("leaves the sources file untouched when nothing is configured", async () => {
    const sourcesPath = makeSourcesFile(DEBIAN_SOURCES_FIXTURE);
    await execFileAsync(process.execPath, [helperScriptPath, sourcesPath], { env: cliEnv() });
    expect(readFileSync(sourcesPath, "utf8")).toBe(DEBIAN_SOURCES_FIXTURE);
  });

  it("rewrites only the configured stanzas in place", async () => {
    const sourcesPath = makeSourcesFile(DEBIAN_SOURCES_FIXTURE);
    await execFileAsync(process.execPath, [helperScriptPath, sourcesPath], {
      env: cliEnv({
        [helper.APT_MAIN_MIRROR_ENV]: "https://mirror.example.com/debian/",
        [helper.APT_SECURITY_MIRROR_ENV]: "https://mirror.example.com/debian-security",
      }),
    });
    const rewritten = readFileSync(sourcesPath, "utf8");
    expect(rewritten).toContain("URIs: https://mirror.example.com/debian\n");
    expect(rewritten).toContain("URIs: https://mirror.example.com/debian-security\n");
    expect(rewritten).not.toContain("deb.debian.org");
  });

  it("fails before apt when the sources file is missing and an override is requested", async () => {
    const dir = mkdtempSync(join(tmpdir(), "homerail-worker-apt-sources-"));
    tempDirs.push(dir);
    const missingPath = join(dir, "debian.sources");
    await expect(execFileAsync(process.execPath, [helperScriptPath, missingPath], {
      env: cliEnv({ [helper.APT_MAIN_MIRROR_ENV]: "https://mirror.example.com/debian" }),
    })).rejects.toMatchObject({ code: 1 });
  });

  it("fails when an override is requested for malformed deb822 input", async () => {
    const sourcesPath = makeSourcesFile("not deb822 at all\n");
    const failure = await execFileAsync(process.execPath, [helperScriptPath, sourcesPath], {
      env: cliEnv({ [helper.APT_SECURITY_MIRROR_ENV]: "https://mirror.example.com/debian-security" }),
    }).then(() => undefined, (error) => error);
    expect(failure).toBeDefined();
    expect(failure?.code).toBe(1);
    expect(String(failure?.stderr)).toContain("Malformed deb822 sources");
    expect(readFileSync(sourcesPath, "utf8")).toBe("not deb822 at all\n");
  });

  it("fails for invalid mirror values naming the key without echoing the value", async () => {
    const sourcesPath = makeSourcesFile(DEBIAN_SOURCES_FIXTURE);
    const invalidValue = "https://user:secret@mirror.example.com/debian";
    const failure = await execFileAsync(process.execPath, [helperScriptPath, sourcesPath], {
      env: cliEnv({ [helper.APT_MAIN_MIRROR_ENV]: invalidValue }),
    }).then(() => undefined, (error) => error);
    expect(failure).toBeDefined();
    expect(failure?.code).toBe(1);
    expect(String(failure?.stderr)).toContain(helper.APT_MAIN_MIRROR_ENV);
    expect(String(failure?.stderr)).not.toContain(invalidValue);
    expect(readFileSync(sourcesPath, "utf8")).toBe(DEBIAN_SOURCES_FIXTURE);
  });
});

describe("Worker Dockerfile source wiring", () => {
  it("keeps exactly one canonical Worker Dockerfile", () => {
    const dockerfiles: string[] = [];
    const visit = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === "dist") continue;
        const full = join(dir, name);
        if (lstatSync(full).isDirectory()) {
          visit(full);
          continue;
        }
        if (/^dockerfile/i.test(name)) dockerfiles.push(full);
      }
    };
    visit(workerRoot);
    expect(dockerfiles).toEqual([join(workerRoot, "Dockerfile")]);
  });

  it("wires the APT override helper into every stage before apt-get update", () => {
    const stages = dockerfileStages();
    expect(stages.length).toBe(2);
    for (const stage of stages) {
      const body = stage.lines.join("\n");
      expect(body).toMatch(/^ARG HOMERAIL_WORKER_BUILD_APT_MIRROR$/m);
      expect(body).toMatch(/^ARG HOMERAIL_WORKER_BUILD_APT_SECURITY_MIRROR$/m);
      expect(body).toContain(
        "COPY homerail_worker/scripts/configure-apt-sources.mjs /opt/homerail/scripts/configure-apt-sources.mjs",
      );
      const helperRunIndex = stage.lines
        .findIndex((line) => line === "RUN node /opt/homerail/scripts/configure-apt-sources.mjs");
      const aptUpdateIndex = runInstructions(stage.lines)
        .find((instruction) => instruction.text.includes("apt-get update"))?.lineIndex ?? -1;
      expect(helperRunIndex).toBeGreaterThanOrEqual(0);
      expect(aptUpdateIndex).toBeGreaterThanOrEqual(0);
      expect(helperRunIndex).toBeLessThan(aptUpdateIndex);
    }
  });

  it("keeps the APT override arguments optional with no vendor default", () => {
    expect(dockerfile).not.toMatch(/ARG HOMERAIL_WORKER_BUILD_APT_MIRROR=/);
    expect(dockerfile).not.toMatch(/ARG HOMERAIL_WORKER_BUILD_APT_SECURITY_MIRROR=/);
  });

  it("declares NPM_CONFIG_REGISTRY before every npm build operation in the final stage", () => {
    const stages = dockerfileStages();
    const finalStage = stages[stages.length - 1];
    const argIndex = finalStage.lines.findIndex((line) => line === "ARG NPM_CONFIG_REGISTRY");
    expect(argIndex).toBeGreaterThanOrEqual(0);
    const npmRuns = npmInstructions(finalStage.lines);
    expect(npmRuns.length).toBeGreaterThan(0);
    for (const instruction of npmRuns) {
      expect(instruction.lineIndex).toBeGreaterThan(argIndex);
    }
    expect(dockerfile.match(/^ARG NPM_CONFIG_REGISTRY$/gm)).toHaveLength(1);
  });

  it("keeps the npm registry override build-only", () => {
    expect(dockerfile).not.toMatch(/ARG NPM_CONFIG_REGISTRY=/);
    expect(dockerfile).not.toMatch(/ENV[^\n]*NPM_CONFIG_REGISTRY/);
    expect(dockerfile).not.toMatch(/ENV[^\n]*HOMERAIL_WORKER_BUILD_APT/);
  });
});

describe("Worker source fingerprint participation", () => {
  it("includes the APT sources helper in the Manager fingerprint inputs", () => {
    const dagEnvironmentSource = readFileSync(
      join(repoRoot, "homerail_manager", "src", "server", "dag-environment.ts"),
      "utf8",
    );
    expect(dagEnvironmentSource).toContain("\"homerail_worker/scripts/configure-apt-sources.mjs\"");
    const inputsMatch = /const SOURCE_INPUTS = \[(.*?)\] as const;/s.exec(dagEnvironmentSource);
    expect(inputsMatch).not.toBeNull();
    expect(inputsMatch?.[1]).toContain("homerail_worker/scripts/configure-apt-sources.mjs");
  });

  it("ships the helper file referenced by the fingerprint inputs", () => {
    expect(lstatSync(helperScriptPath).isFile()).toBe(true);
  });
});
