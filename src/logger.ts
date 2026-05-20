export interface LoggerSink {
  readonly handlesOutput?: boolean;
  auditSettings?(summary: AuditSettingsSummary): void;
  phaseStarted?(phase: AuditPhaseProgress): void;
  phaseFinished?(phase: AuditPhaseProgress): void;
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
