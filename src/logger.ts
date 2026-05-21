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
  private readonly providerHeartbeats = new Map<string, {
    startedAt?: number;
    pid?: number;
    bytes: number;
    lastReportedAt: number;
    lastStream?: "stdout" | "stderr";
  }>();

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
    if (!this.progressEnabled || this.sink?.handlesOutput) {
      return;
    }
    const heartbeat = this.providerHeartbeats.get(event.providerId) ?? {
      bytes: 0,
      lastReportedAt: 0
    };
    const parsedAt = Date.parse(event.at);
    const timestamp = Number.isFinite(parsedAt) ? parsedAt : Date.now();
    if (event.type === "spawned") {
      heartbeat.startedAt = timestamp;
      heartbeat.pid = event.pid;
      this.providerHeartbeats.set(event.providerId, heartbeat);
      if (event.pid) {
        process.stderr.write(`.. ${event.providerId} spawned pid ${event.pid}\n`);
      }
      return;
    }
    if (event.type === "closed") {
      this.providerHeartbeats.delete(event.providerId);
      return;
    }
    heartbeat.bytes += event.bytes ?? 0;
    heartbeat.lastStream = event.stream;
    this.providerHeartbeats.set(event.providerId, heartbeat);
    if (timestamp - heartbeat.lastReportedAt < 60_000) {
      return;
    }
    heartbeat.lastReportedAt = timestamp;
    const elapsed = heartbeat.startedAt ? ` for ${formatDuration(timestamp - heartbeat.startedAt)}` : "";
    const stream = heartbeat.lastStream ? ` on ${heartbeat.lastStream}` : "";
    process.stderr.write(`.. ${event.providerId} active${elapsed}: ${formatBytes(heartbeat.bytes)} provider output${stream}\n`);
  }

  providerFinished(provider: AuditProviderProgress): void {
    this.sink?.providerFinished?.(provider);
    this.providerHeartbeats.delete(provider.id);
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

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes}B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 102.4) / 10}KB`;
  }
  return `${Math.round(bytes / (1024 * 102.4)) / 10}MB`;
}
