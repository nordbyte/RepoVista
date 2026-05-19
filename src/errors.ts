export class RepoVistaError extends Error {
  readonly code: string;

  constructor(message: string, code = "REPOVISTA_ERROR") {
    super(message);
    this.name = "RepoVistaError";
    this.code = code;
  }
}

export class CliUsageError extends RepoVistaError {
  constructor(message: string) {
    super(message, "CLI_USAGE_ERROR");
    this.name = "CliUsageError";
  }
}

export class PreflightError extends RepoVistaError {
  constructor(message: string) {
    super(message, "PREFLIGHT_ERROR");
    this.name = "PreflightError";
  }
}

export class AuditCancelledError extends RepoVistaError {
  constructor(message = "RepoVista audit was cancelled.") {
    super(message, "AUDIT_CANCELLED");
    this.name = "AuditCancelledError";
  }
}
