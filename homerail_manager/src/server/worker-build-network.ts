export const WORKER_BUILD_APT_MIRROR_ENV_KEY = "HOMERAIL_WORKER_BUILD_APT_MIRROR";
export const WORKER_BUILD_APT_SECURITY_MIRROR_ENV_KEY = "HOMERAIL_WORKER_BUILD_APT_SECURITY_MIRROR";
export const WORKER_BUILD_NPM_REGISTRY_ENV_KEY = "HOMERAIL_WORKER_BUILD_NPM_REGISTRY";

export const WORKER_BUILD_APT_MIRROR_BUILD_ARG = "HOMERAIL_WORKER_BUILD_APT_MIRROR";
export const WORKER_BUILD_APT_SECURITY_MIRROR_BUILD_ARG = "HOMERAIL_WORKER_BUILD_APT_SECURITY_MIRROR";
export const WORKER_BUILD_NPM_REGISTRY_BUILD_ARG = "NPM_CONFIG_REGISTRY";

// Uppercase and lowercase spellings are recognized; values are never read
// beyond an emptiness check and stay solely in the Docker child environment.
export const WORKER_BUILD_PROXY_VARIABLE_NAMES = [
  "HTTP_PROXY",
  "http_proxy",
  "HTTPS_PROXY",
  "https_proxy",
  "NO_PROXY",
  "no_proxy",
] as const;

export type WorkerBuildNetworkSourceMode = "default" | "custom";
export type WorkerBuildNetworkProxyMode = "environment" | "docker-managed";

export interface WorkerBuildNetworkSummary {
  apt_main: WorkerBuildNetworkSourceMode;
  apt_security: WorkerBuildNetworkSourceMode;
  npm: WorkerBuildNetworkSourceMode;
  proxy: WorkerBuildNetworkProxyMode;
}

export interface WorkerBuildNetworkConfig {
  aptMirror?: string;
  aptSecurityMirror?: string;
  npmRegistry?: string;
  proxyVariableNames: string[];
}

export const DEFAULT_WORKER_BUILD_NETWORK_SUMMARY: WorkerBuildNetworkSummary = {
  apt_main: "default",
  apt_security: "default",
  npm: "default",
  proxy: "docker-managed",
};

export class WorkerBuildNetworkError extends Error {
  readonly envKey: string;

  constructor(envKey: string, reason: string) {
    // The message names the configuration key but never the rejected value.
    super(`Invalid ${envKey} configuration: ${reason}`);
    this.name = "WorkerBuildNetworkError";
    this.envKey = envKey;
  }
}

const FORBIDDEN_SOURCE_CHARACTERS = /[\u0000-\u001f\u007f\s]/;

function normalizeTrailingSlashes(href: string): string {
  return href.replace(/\/+$/, "");
}

function resolveSourceUrl(envKey: string, raw: string | undefined): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  // URL parsing silently strips ASCII tabs/newlines and tolerates other
  // surprises, so reject control characters and whitespace up front.
  if (FORBIDDEN_SOURCE_CHARACTERS.test(trimmed)) {
    throw new WorkerBuildNetworkError(
      envKey,
      "value must not contain whitespace or control characters.",
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new WorkerBuildNetworkError(envKey, "value must be an absolute http: or https: URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new WorkerBuildNetworkError(envKey, "only http: and https: URLs are supported.");
  }
  if (!parsed.hostname) {
    throw new WorkerBuildNetworkError(envKey, "value must include a hostname.");
  }
  if (parsed.username || parsed.password) {
    throw new WorkerBuildNetworkError(envKey, "credential-bearing URLs are not supported.");
  }
  if (parsed.search || parsed.hash) {
    throw new WorkerBuildNetworkError(envKey, "value must not include a query or fragment.");
  }
  return normalizeTrailingSlashes(parsed.toString());
}

function resolveProxyVariableNames(env: NodeJS.ProcessEnv): string[] {
  const names: string[] = [];
  for (const name of WORKER_BUILD_PROXY_VARIABLE_NAMES) {
    const value = env[name];
    if (typeof value === "string" && value.trim()) names.push(name);
  }
  return names;
}

export function resolveWorkerBuildNetwork(
  env: NodeJS.ProcessEnv = process.env,
): WorkerBuildNetworkConfig {
  return {
    aptMirror: resolveSourceUrl(WORKER_BUILD_APT_MIRROR_ENV_KEY, env[WORKER_BUILD_APT_MIRROR_ENV_KEY]),
    aptSecurityMirror: resolveSourceUrl(
      WORKER_BUILD_APT_SECURITY_MIRROR_ENV_KEY,
      env[WORKER_BUILD_APT_SECURITY_MIRROR_ENV_KEY],
    ),
    npmRegistry: resolveSourceUrl(WORKER_BUILD_NPM_REGISTRY_ENV_KEY, env[WORKER_BUILD_NPM_REGISTRY_ENV_KEY]),
    proxyVariableNames: resolveProxyVariableNames(env),
  };
}

export function workerBuildNetworkDockerArgs(config: WorkerBuildNetworkConfig): string[] {
  const args: string[] = [];
  if (config.aptMirror) {
    args.push("--build-arg", `${WORKER_BUILD_APT_MIRROR_BUILD_ARG}=${config.aptMirror}`);
  }
  if (config.aptSecurityMirror) {
    args.push("--build-arg", `${WORKER_BUILD_APT_SECURITY_MIRROR_BUILD_ARG}=${config.aptSecurityMirror}`);
  }
  if (config.npmRegistry) {
    args.push("--build-arg", `${WORKER_BUILD_NPM_REGISTRY_BUILD_ARG}=${config.npmRegistry}`);
  }
  // Value-less entries let Docker resolve the value from the child
  // environment; HomeRail never places proxy values in argv.
  for (const name of config.proxyVariableNames) {
    args.push("--build-arg", name);
  }
  return args;
}

export function workerBuildNetworkSummary(config: WorkerBuildNetworkConfig): WorkerBuildNetworkSummary {
  return {
    apt_main: config.aptMirror ? "custom" : "default",
    apt_security: config.aptSecurityMirror ? "custom" : "default",
    npm: config.npmRegistry ? "custom" : "default",
    proxy: config.proxyVariableNames.length > 0 ? "environment" : "docker-managed",
  };
}

export function normalizeWorkerBuildNetworkSummary(
  value: unknown,
): WorkerBuildNetworkSummary | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  return {
    apt_main: record.apt_main === "custom" ? "custom" : "default",
    apt_security: record.apt_security === "custom" ? "custom" : "default",
    npm: record.npm === "custom" ? "custom" : "default",
    proxy: record.proxy === "environment" ? "environment" : "docker-managed",
  };
}
