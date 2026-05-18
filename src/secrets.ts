const SENSITIVE_KEY_PATTERN = /(token|secret|password|passwd|pwd|api[_-]?key|private[_-]?key|auth|bearer|credential|client[_-]?secret)/i;
const ENV_ASSIGNMENT_PATTERN = /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|PWD|API_KEY|PRIVATE_KEY|AUTH|BEARER|CREDENTIAL|CLIENT_SECRET)[A-Z0-9_]*)\s*=\s*("[^"]*"|'[^']*'|[^\s]+)/gi;
const URL_CREDENTIAL_PATTERN = /([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^/\s@]+)@/gi;

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

export function maskSensitiveText(value: string): string {
  return value
    .replace(ENV_ASSIGNMENT_PATTERN, "$1=[masked]")
    .replace(URL_CREDENTIAL_PATTERN, "$1[masked]@");
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
