export class Logger {
  constructor(private readonly progressEnabled: boolean) {}

  info(message: string): void {
    if (this.progressEnabled) {
      process.stderr.write(`${message}\n`);
    }
  }

  step(message: string): void {
    this.info(`-> ${message}`);
  }

  warn(message: string): void {
    process.stderr.write(`Warnung: ${message}\n`);
  }

  error(message: string): void {
    process.stderr.write(`Fehler: ${message}\n`);
  }
}
