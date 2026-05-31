import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AuditMeta, AuditOptions, PhaseReportStatus, RunPaths } from "./types.js";
import type { AuditPhaseProgress, AuditProviderEvent, AuditProviderProgress, AuditSettingsSummary, LoggerSink } from "./logger.js";

export interface RepoVistaRunStatusMessage {
  at: string;
  level: "info" | "warn" | "error";
  message: string;
}

export interface RepoVistaProviderStatus {
  id: string;
  title: string;
  parentPhaseId: string;
  kind: AuditProviderProgress["kind"];
  status: NonNullable<AuditProviderProgress["status"]>;
  queuedAt?: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  pid?: number;
  outputBytes: number;
  lastOutputAt?: string;
  error?: string;
}

export interface RepoVistaRunStatus {
  schemaVersion: 1;
  runId: string;
  runDir: string;
  projectRoot: string;
  status: "running" | "success" | "failed" | "cancelled";
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  durationMs?: number;
  exitCode?: number;
  currentStep?: string;
  auditSettings?: AuditSettingsSummary;
  options: {
    provider?: string;
    model?: string;
    reasoning?: string;
    profile?: string;
    sandbox?: string;
    outDir?: string;
    auditProfile?: string;
    reviewMode?: string;
    phases?: string[];
    exportFormats?: string[];
  };
  phases: PhaseReportStatus[];
  providers: RepoVistaProviderStatus[];
  messages: RepoVistaRunStatusMessage[];
}

export interface RepoVistaRunStatusRecorder {
  readonly sink: LoggerSink;
  write(status?: RepoVistaRunStatus["status"], exitCode?: number): Promise<void>;
  finish(exitCode: number | undefined): Promise<void>;
}

const MAX_MESSAGES = 50;

export function createRunStatusRecorder(input: {
  projectRoot: string;
  paths: RunPaths;
  meta: AuditMeta;
  options: AuditOptions;
  statusFile?: string;
  now?: () => Date;
}): RepoVistaRunStatusRecorder {
  const now = input.now ?? (() => new Date());
  const statusFile = input.statusFile ?? path.join(input.paths.runDir, "status.json");
  const providers = new Map<string, RepoVistaProviderStatus>();
  const messages: RepoVistaRunStatusMessage[] = [];
  let currentStep: string | undefined;
  let auditSettings: AuditSettingsSummary | undefined;
  let status: RepoVistaRunStatus["status"] = "running";
  let exitCode: number | undefined;
  let queue = Promise.resolve();

  const addMessage = (level: RepoVistaRunStatusMessage["level"], message: string) => {
    messages.push({ at: now().toISOString(), level, message });
    while (messages.length > MAX_MESSAGES) {
      messages.shift();
    }
    scheduleWrite();
  };

  const snapshot = (): RepoVistaRunStatus => {
    const updatedAt = now().toISOString();
    return {
      schemaVersion: 1,
      runId: input.paths.runId,
      runDir: input.paths.runDir,
      projectRoot: input.projectRoot,
      status,
      startedAt: input.meta.startedAt,
      updatedAt,
      completedAt: input.meta.completedAt,
      durationMs: input.meta.durationMs,
      exitCode,
      currentStep,
      auditSettings,
      options: {
        provider: input.options.provider,
        model: input.options.model,
        reasoning: input.options.reasoning,
        profile: input.options.profile,
        sandbox: input.options.sandbox,
        outDir: input.options.outDir,
        auditProfile: input.options.auditProfile,
        reviewMode: input.options.reviewMode,
        phases: input.options.phases,
        exportFormats: input.options.exportFormats
      },
      phases: input.meta.phases,
      providers: Array.from(providers.values()),
      messages: [...messages]
    };
  };

  const writeSnapshot = async () => {
    await mkdir(path.dirname(statusFile), { recursive: true });
    const tempFile = `${statusFile}.${process.pid}.tmp`;
    await writeFile(tempFile, `${JSON.stringify(snapshot(), null, 2)}\n`, "utf8");
    await rename(tempFile, statusFile);
  };

  const scheduleWrite = () => {
    queue = queue.then(writeSnapshot, writeSnapshot);
  };

  const upsertProvider = (provider: AuditProviderProgress, nextStatus: NonNullable<AuditProviderProgress["status"]>) => {
    const existing = providers.get(provider.id) ?? {
      id: provider.id,
      title: provider.title,
      parentPhaseId: provider.parentPhaseId,
      kind: provider.kind,
      status: nextStatus,
      outputBytes: 0
    };
    existing.title = provider.title;
    existing.parentPhaseId = provider.parentPhaseId;
    existing.kind = provider.kind;
    existing.status = nextStatus;
    existing.durationMs = provider.durationMs ?? existing.durationMs;
    existing.error = provider.error ?? existing.error;
    if (nextStatus === "queued") existing.queuedAt = existing.queuedAt ?? now().toISOString();
    if (nextStatus === "running") existing.startedAt = existing.startedAt ?? now().toISOString();
    if (nextStatus === "done" || nextStatus === "failed" || nextStatus === "cancelled") existing.finishedAt = now().toISOString();
    providers.set(provider.id, existing);
    scheduleWrite();
  };

  const sink: LoggerSink = {
    auditSettings(summary) {
      auditSettings = summary;
      scheduleWrite();
    },
    step(message) {
      currentStep = message;
      addMessage("info", message);
    },
    phaseStarted(phase: AuditPhaseProgress) {
      currentStep = phase.title;
      addMessage("info", `${phase.title} started.`);
    },
    phaseFinished(phase: AuditPhaseProgress) {
      currentStep = phase.title;
      addMessage(phase.status === "failed" ? "error" : "info", `${phase.title} ${phase.status ?? "done"}${phase.error ? `: ${phase.error}` : ""}.`);
    },
    providerQueued(provider) {
      upsertProvider(provider, "queued");
    },
    providerStarted(provider) {
      upsertProvider(provider, "running");
    },
    providerEvent(event: AuditProviderEvent) {
      const existing = providers.get(event.providerId);
      if (!existing) return;
      if (event.type === "spawned") {
        existing.pid = event.pid;
        existing.startedAt = event.at;
      } else if (event.type === "output") {
        existing.outputBytes += event.bytes ?? 0;
        existing.lastOutputAt = event.at;
      } else if (event.type === "closed") {
        existing.finishedAt = event.at;
        existing.status = event.exitCode === 0 ? "done" : "failed";
      }
      scheduleWrite();
    },
    providerFinished(provider) {
      upsertProvider(provider, provider.status ?? "done");
    },
    info(message) {
      addMessage("info", message);
    },
    warn(message) {
      addMessage("warn", message);
    },
    error(message) {
      addMessage("error", message);
    }
  };

  scheduleWrite();

  return {
    sink,
    async write(nextStatus = status, nextExitCode = exitCode) {
      status = nextStatus;
      exitCode = nextExitCode;
      scheduleWrite();
      await queue;
    },
    async finish(nextExitCode) {
      exitCode = nextExitCode;
      status = nextExitCode === 130 ? "cancelled" : nextExitCode === 0 ? "success" : "failed";
      await this.write(status, nextExitCode);
    }
  };
}

export function combineLoggerSinks(...sinks: Array<LoggerSink | undefined>): LoggerSink | undefined {
  const active = sinks.filter((sink): sink is LoggerSink => Boolean(sink));
  if (!active.length) return undefined;
  return {
    handlesOutput: active.some((sink) => sink.handlesOutput),
    auditSettings(summary) {
      for (const sink of active) sink.auditSettings?.(summary);
    },
    phaseStarted(phase) {
      for (const sink of active) sink.phaseStarted?.(phase);
    },
    phaseFinished(phase) {
      for (const sink of active) sink.phaseFinished?.(phase);
    },
    providerQueued(provider) {
      for (const sink of active) sink.providerQueued?.(provider);
    },
    providerStarted(provider) {
      for (const sink of active) sink.providerStarted?.(provider);
    },
    providerEvent(event) {
      for (const sink of active) sink.providerEvent?.(event);
    },
    providerFinished(provider) {
      for (const sink of active) sink.providerFinished?.(provider);
    },
    info(message) {
      for (const sink of active) sink.info?.(message);
    },
    step(message) {
      for (const sink of active) sink.step?.(message);
    },
    warn(message) {
      for (const sink of active) sink.warn?.(message);
    },
    error(message) {
      for (const sink of active) sink.error?.(message);
    }
  };
}
