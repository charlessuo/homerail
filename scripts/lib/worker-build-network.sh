#!/usr/bin/env bash

# Shared Worker build network contract for operator entry points.
#
# Public source settings (identical names and validation to the Manager's
# resolver in homerail_manager/src/server/worker-build-network.ts):
#
#   HOMERAIL_WORKER_BUILD_APT_MIRROR           optional Debian main repository URL
#   HOMERAIL_WORKER_BUILD_APT_SECURITY_MIRROR  optional Debian security repository URL
#   HOMERAIL_WORKER_BUILD_NPM_REGISTRY         optional npm registry URL
#
# Unset or whitespace-only values leave the corresponding source unchanged.
# Valid values use http: or https:, have a hostname, and contain no username,
# password, query, fragment, control characters, or raw whitespace. Trailing
# slashes, scheme case, and host case are normalized so semantically identical
# URLs produce identical build arguments. Invalid values fail before Docker
# starts; the error names the configuration key but never its value.
#
# Recognized uppercase and lowercase HTTP_PROXY, HTTPS_PROXY, and NO_PROXY
# variables are forwarded as value-less Docker --build-arg NAME entries only
# when non-empty. Their values are never expanded into argv, inspected, or
# logged; the Docker client/BuildKit proxy configuration remains authoritative.
#
# The helper only appends to a caller-provided argv array. It never evaluates
# or executes validated input. Callers must use `set -euo pipefail`.

# homerail_worker_build_network_normalize_source NAME VALUE
#
# Prints the normalized URL for the public source setting NAME. Prints nothing
# and returns 0 when VALUE is unset-equivalent (empty or whitespace-only).
# Returns 1 with an error naming NAME (never VALUE) when VALUE is invalid.
homerail_worker_build_network_normalize_source() {
  local LC_ALL=C
  local name="$1"
  local value="${2-}"
  local error="$name must be a public http: or https: URL with a hostname and no credentials, query, fragment, control characters, or whitespace."

  # Trim surrounding whitespace; whitespace-only values leave the source unchanged.
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  if [ -z "$value" ]; then
    return 0
  fi

  # Reject control characters and raw whitespace anywhere in the value.
  if ! [[ "$value" =~ ^[[:print:]]+$ ]] || [[ "$value" == *" "* ]]; then
    echo "$error" >&2
    return 1
  fi

  local lower scheme rest
  lower="${value,,}"
  case "$lower" in
    http://*) scheme="http"; rest="${value:7}" ;;
    https://*) scheme="https"; rest="${value:8}" ;;
    *)
      echo "$error" >&2
      return 1
      ;;
  esac

  # Credentials, queries, and fragments are rejected outright.
  case "$rest" in
    *"@"* | *"?"* | *"#"*)
      echo "$error" >&2
      return 1
      ;;
  esac

  local authority url_path
  if [[ "$rest" == */* ]]; then
    authority="${rest%%/*}"
    url_path="/${rest#*/}"
  else
    authority="$rest"
    url_path=""
  fi
  if [ -z "$authority" ]; then
    echo "$error" >&2
    return 1
  fi

  local host port_part=""
  if [[ "$authority" == "["* ]]; then
    if [[ ! "$authority" =~ ^\[([0-9A-Fa-f:]+)\](:[0-9]+)?$ ]] || [[ "${BASH_REMATCH[1]}" != *::* ]]; then
      echo "$error" >&2
      return 1
    fi
    host="[${BASH_REMATCH[1],,}]"
    port_part="${BASH_REMATCH[2]}"
  else
    if [[ "$authority" == *:* ]]; then
      host="${authority%%:*}"
      port_part=":${authority#*:}"
    else
      host="$authority"
    fi
    if [[ ! "$host" =~ ^[A-Za-z0-9._~-]+$ ]]; then
      echo "$error" >&2
      return 1
    fi
    host="${host,,}"
  fi
  if [ -n "$port_part" ] && [[ ! "$port_part" =~ ^:[0-9]{1,5}$ ]]; then
    echo "$error" >&2
    return 1
  fi

  # Paths keep only unreserved/sub-delimiter URL characters; anything else
  # fails closed instead of reaching Docker argv.
  local path_pattern="^/[A-Za-z0-9._~:/!$&'()*+,;=%-]*$"
  if [ -n "$url_path" ] && ! [[ "$url_path" =~ $path_pattern ]]; then
    echo "$error" >&2
    return 1
  fi

  # Normalize harmless trailing-slash differences.
  while [[ "$url_path" == */ ]]; do
    url_path="${url_path%/}"
  done

  printf '%s://%s%s%s\n' "$scheme" "$host" "$port_part" "$url_path"
}

# homerail_worker_build_network_args ARRAY_NAME
#
# Validates the public build source settings from the environment and appends
# Docker build arguments to the caller's argv array named ARRAY_NAME:
#   --build-arg HOMERAIL_WORKER_BUILD_APT_MIRROR=<url>
#   --build-arg HOMERAIL_WORKER_BUILD_APT_SECURITY_MIRROR=<url>
#   --build-arg NPM_CONFIG_REGISTRY=<url>
# plus one value-less --build-arg NAME entry for every non-empty recognized
# proxy variable. Returns 1 before any Docker invocation when a value is
# invalid.
homerail_worker_build_network_args() {
  local -n _homerail_worker_build_network_args="$1"
  local name normalized proxy_name
  for name in HOMERAIL_WORKER_BUILD_APT_MIRROR HOMERAIL_WORKER_BUILD_APT_SECURITY_MIRROR HOMERAIL_WORKER_BUILD_NPM_REGISTRY; do
    if ! normalized="$(homerail_worker_build_network_normalize_source "$name" "${!name-}")"; then
      return 1
    fi
    if [ -n "$normalized" ]; then
      if [ "$name" = "HOMERAIL_WORKER_BUILD_NPM_REGISTRY" ]; then
        _homerail_worker_build_network_args+=("--build-arg" "NPM_CONFIG_REGISTRY=$normalized")
      else
        _homerail_worker_build_network_args+=("--build-arg" "$name=$normalized")
      fi
    fi
  done
  for proxy_name in HTTP_PROXY HTTPS_PROXY NO_PROXY http_proxy https_proxy no_proxy; do
    if [ -n "${!proxy_name-}" ]; then
      _homerail_worker_build_network_args+=("--build-arg" "$proxy_name")
    fi
  done
  return 0
}
