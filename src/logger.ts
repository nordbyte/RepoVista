export interface LoggerSink {
  readonly handlesOutput?: boolean;
  auditSettings?(summary: AuditSettingsSummary): void;
  info?(message: string): void;
  step?(message: string): void;
  warn?(message: string): void;
  error?(message: string): void;
}

export interface AuditSettingsSummary {
  title: string;
  lines: string[];
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
