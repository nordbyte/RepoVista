const SENSITIVE_KEY_PATTERN = /(token|secret|password|passwd|pwd|api[_-]?key|private[_-]?key|auth|bearer|credential|client[_-]?secret)/i;
const ENV_ASSIGNMENT_PATTERN = /\b([A-Za-z_][A-Za-z0-9_-]{0,127})(\s*=\s*)("[^"]*"|'[^']*'|[^\s]+)/g;
const URL_CREDENTIAL_PATTERN = /([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^/\s@]+)@/gi;
const HEADER_SECRET_PATTERN = /\b(authorization|x-api-key|api-key|npm-token|github-token)\s*[:=]\s*(bearer\s+)?[^\s'",;]+/gi;
const JSON_SECRET_PATTERN = /(["']?(?:token|secret|password|passwd|pwd|api[_-]?key|private[_-]?key|auth|bearer|credential|client[_-]?secret)["']?\s*:\s*["'])([^"']+)(["'])/gi;
const WELL_KNOWN_TOKEN_PATTERN = /\b(?:ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|npm_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,})\b/g;
const STREAM_MASK_CARRY_LENGTH = 512;
const SENSITIVE_ENV_WORDS = new Set(["token", "secret", "password", "passwd", "pwd", "auth", "bearer", "credential", "credentials"]);

export interface SensitiveTextMasker {
  push(chunk: string): string;
  flush(): string;
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

export function maskSensitiveText(value: string): string {
  return value
    .replace(ENV_ASSIGNMENT_PATTERN, (match, key: string, separator: string) => isSensitiveEnvAssignmentKey(key) ? `${key}${separator}[masked]` : match)
    .replace(URL_CREDENTIAL_PATTERN, "$1[masked]@")
    .replace(HEADER_SECRET_PATTERN, "$1: [masked]")
    .replace(JSON_SECRET_PATTERN, "$1[masked]$3")
    .replace(WELL_KNOWN_TOKEN_PATTERN, "[masked]");
}

function isSensitiveEnvAssignmentKey(key: string): boolean {
  const parts = key.split(/[_-]+/).filter(Boolean).map((part) => part.toLowerCase());
  if (parts.some((part) => SENSITIVE_ENV_WORDS.has(part))) {
    return true;
  }

  const normalized = parts.join("_");
  return normalized.includes("api_key") || normalized.includes("private_key") || normalized.includes("client_secret");
}

export function createSensitiveTextMasker(carryLength = STREAM_MASK_CARRY_LENGTH): SensitiveTextMasker {
  let carry = "";
  return {
    push(chunk: string): string {
      const combined = carry + chunk;
      const emitLength = Math.max(0, combined.length - carryLength);
      const emit = combined.slice(0, emitLength);
      carry = combined.slice(emitLength);
      return emit ? maskSensitiveText(emit) : "";
    },
    flush(): string {
      const output = carry ? maskSensitiveText(carry) : "";
      carry = "";
      return output;
    }
  };
}

export function maskSensitiveValue(key: string, value: unknown): unknown {
  if (isSensitiveKey(key)) {
    return "[masked]";
  }

  if (typeof value === "string") {
    return maskSensitiveText(value);
  }

  return value;
}

export function maskObject<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => maskObject(item)) as T;
  }

  if (value && typeof value === "object") {
    const masked: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      masked[key] = maskSensitiveValue(key, maskObject(item));
    }
    return masked as T;
  }

  return value;
}
