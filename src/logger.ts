export interface LoggerSink {
  readonly handlesOutput?: boolean;
  auditSettings?(summary: AuditSettingsSummary): void;
  phaseStarted?(phase: AuditPhaseProgress): void;
  phaseFinished?(phase: AuditPhaseProgress): void;
  providerQueued?(provider: AuditProviderProgress): void;
  providerStarted?(provider: AuditProviderProgress): void;
  providerEvent?(event: AuditProviderEvent): void;
  providerFinished?(provider: AuditProviderProgress): void;
  info?(message: string): void;
  step?(message: string): void;
  warn?(message: string): void;
  error?(message: string): void;
}

export interface AuditSettingsSummary {
  title: string;
  lines: string[];
}

export interface AuditPhaseProgress {
  id: string;
  title: string;
  status?: "running" | "done" | "failed" | "cancelled" | "skipped";
  error?: string;
}

export interface AuditProviderProgress {
  id: string;
  title: string;
  parentPhaseId: string;
  kind: "phase" | "shard" | "synthesis" | "repair" | "deep-review";
  status?: "queued" | "running" | "done" | "failed" | "cancelled";
  durationMs?: number;
  error?: string;
}

export interface AuditProviderEvent {
  providerId: string;
  parentPhaseId: string;
  type: "spawned" | "output" | "closed";
  at: string;
  pid?: number;
  stream?: "stdout" | "stderr";
  bytes?: number;
  exitCode?: number | null;
  signal?: string | null;
}

export class Logger {
  constructor(private readonly progressEnabled: boolean, private readonly sink?: LoggerSink) {}

  auditSettings(summary: AuditSettingsSummary): void {
    this.sink?.auditSettings?.(summary);
    if (this.progressEnabled && !this.sink?.handlesOutput) {
      process.stderr.write(`${summary.title}:\n${summary.lines.map((line) => `  ${line}`).join("\n")}\n`);
    }
  }

  info(message: string): void {
    this.sink?.info?.(message);
    if (this.progressEnabled && !this.sink?.handlesOutput) {
      process.stderr.write(`${message}\n`);
    }
  }

  step(message: string): void {
    this.sink?.step?.(message);
    this.info(`-> ${message}`);
  }

  phaseStarted(phase: AuditPhaseProgress): void {
    this.sink?.phaseStarted?.({ ...phase, status: "running" });
    if (this.progressEnabled && !this.sink?.handlesOutput) {
      process.stderr.write(`-> ${phase.title}\n`);
    }
  }

  phaseFinished(phase: AuditPhaseProgress): void {
    this.sink?.phaseFinished?.(phase);
    if (this.progressEnabled && !this.sink?.handlesOutput) {
      const status = phase.status ? ` (${phase.status})` : "";
      process.stderr.write(`<- ${phase.title}${status}${phase.error ? `: ${phase.error}` : ""}\n`);
    }
  }

  providerQueued(provider: AuditProviderProgress): void {
    this.sink?.providerQueued?.({ ...provider, status: "queued" });
    if (this.progressEnabled && !this.sink?.handlesOutput) {
      process.stderr.write(`.. ${provider.title} queued\n`);
    }
  }

  providerStarted(provider: AuditProviderProgress): void {
    this.sink?.providerStarted?.({ ...provider, status: "running" });
    if (this.progressEnabled && !this.sink?.handlesOutput) {
      process.stderr.write(`=> ${provider.title}\n`);
    }
  }

  providerEvent(event: AuditProviderEvent): void {
    this.sink?.providerEvent?.(event);
  }

  providerFinished(provider: AuditProviderProgress): void {
    this.sink?.providerFinished?.(provider);
    if (this.progressEnabled && !this.sink?.handlesOutput) {
      const status = provider.status ? ` (${provider.status})` : "";
      process.stderr.write(`<= ${provider.title}${status}${provider.error ? `: ${provider.error}` : ""}\n`);
    }
  }

  warn(message: string): void {
    this.sink?.warn?.(message);
    if (!this.sink?.handlesOutput) {
      process.stderr.write(`Warning: ${message}\n`);
    }
  }

  error(message: string): void {
    this.sink?.error?.(message);
    if (!this.sink?.handlesOutput) {
      process.stderr.write(`Error: ${message}\n`);
    }
  }
}
