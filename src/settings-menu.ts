import readline from "node:readline";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ReadStream, WriteStream } from "node:tty";
import { RepoVistaError } from "./errors.js";
import {
  loadProviderModels,
  reasoningOptionsForProviderModel,
  type ProviderModelInfo
} from "./provider-models.js";
import { getReportProvider, REPORT_PROVIDER_IDS } from "./providers/index.js";
import { AUDIT_PROFILES } from "./profiles.js";
import { getSettingsPath, loadSettings, saveSettings, type RepoVistaSettings } from "./settings-config.js";
import { DEFAULT_OPTIONS } from "./options.js";
import { menuItemIdsFromRegistry } from "./option-registry.js";
import type { AiProviderId, ParallelMode, ReportExportFormat, ReviewMode, SandboxMode } from "./types.js";

export type MenuScreen = "main" | "provider" | "parallel" | "auditProfile" | "reviewMode" | "model" | "reasoning" | "fastMode" | "sandbox" | "language" | "checkCommands" | "exportFormats" | "checkTimeout" | "phaseTimeout";

interface MenuState {
  screen: MenuScreen;
  cursor: number;
  settings: RepoVistaSettings;
  modelsByProvider: Record<AiProviderId, ProviderModelInfo[]>;
  checkCommandOptions: string[];
  done: boolean;
  saved: boolean;
  settingsPath: string;
  lastFrame?: string;
}

type MainItem =
  | { id: "provider" | "parallel" | "auditProfile" | "reviewMode" | "model" | "reasoning" | "fastMode" | "sandbox" | "language" | "checkCommands" | "exportFormats" | "checkTimeout" | "phaseTimeout"; type: "submenu"; label: (settings: RepoVistaSettings) => string }
  | { id: "runChecks" | "json" | "keepLogs" | "progress" | "ci" | "failOnCritical" | "strictReports" | "repairReports" | "deepReview" | "allWorkspaces" | "incremental"; type: "toggle"; label: (settings: RepoVistaSettings) => string }
  | { id: "profile" | "workspace" | "outDir" | "promptFile" | "includes" | "ignores"; type: "text"; label: (settings: RepoVistaSettings) => string }
  | { id: "save" | "exit"; type: "command"; label: () => string };

const LANGUAGE_OPTIONS = ["English", "German", "Spanish", "French", "Italian", "Portuguese"];
const SANDBOX_OPTIONS: SandboxMode[] = ["read-only", "workspace-write"];
const CHECK_TIMEOUT_OPTIONS = [60, 300, 600, 900, 1800, 3600];
const PHASE_TIMEOUT_OPTIONS = [900, 1800, 3600, 5400, 7200];
const PARALLEL_OPTIONS: ParallelMode[] = ["off", "auto", 2, 3, 4, 5];
const REVIEW_MODE_OPTIONS: ReviewMode[] = ["default", "deslopify", "security", "test-gaps"];
const EXPORT_FORMAT_OPTIONS: ReportExportFormat[] = ["sarif", "html", "jsonl", "github"];
const FAST_MODE_OPTIONS = ["on", "off"] as const;
const RENDER_DEBOUNCE_MS = 16;

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  gray: "\x1b[90m",
  white: "\x1b[97m",
  bgCyan: "\x1b[46m"
} as const;

export async function runSettingsMenu(
  input = process.stdin as ReadStream,
  output = process.stdout as WriteStream
): Promise<RepoVistaSettings> {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
    throw new RepoVistaError("The settings command requires an interactive terminal.", "SETTINGS_NOT_INTERACTIVE");
  }

  const settingsPath = getSettingsPath();
  const settings = await loadSettings(settingsPath);
  const modelsByProvider = Object.fromEntries(await Promise.all(REPORT_PROVIDER_IDS.map(async (providerId) => [
    providerId,
    await loadProviderModels(providerId)
  ])));
  const checkCommandOptions = await loadCheckCommandOptions(process.cwd());
  const state: MenuState = {
    screen: "main",
    cursor: 0,
    settings,
    modelsByProvider,
    checkCommandOptions,
    done: false,
    saved: false,
    settingsPath
  };

  readline.emitKeypressEvents(input);
  input.setRawMode(true);
  input.resume();

  return new Promise((resolve, reject) => {
    let renderTimer: ReturnType<typeof setTimeout> | undefined;

    const requestRender = () => {
      if (renderTimer) {
        return;
      }
      renderTimer = setTimeout(() => {
        renderTimer = undefined;
        render(state, output);
      }, RENDER_DEBOUNCE_MS);
      renderTimer.unref();
    };

    const flushRender = () => {
      if (renderTimer) {
        clearTimeout(renderTimer);
        renderTimer = undefined;
      }
      render(state, output);
    };

    const cleanup = () => {
      if (renderTimer) {
        clearTimeout(renderTimer);
        renderTimer = undefined;
      }
      input.off("keypress", onKeypress);
      input.setRawMode(false);
      input.pause();
      output.write("\x1b[?25h\x1b[?1049l");
    };

    const finish = async () => {
      try {
        flushRender();
        cleanup();
        if (state.saved) {
          await saveSettings(state.settings, state.settingsPath);
          output.write(`\nSaved RepoVista settings to ${state.settingsPath}\n`);
        } else {
          output.write("\nSettings unchanged.\n");
        }
        resolve(state.settings);
      } catch (error) {
        reject(error);
      }
    };

    const onKeypress = (_value: string, key: { name?: string; ctrl?: boolean }) => {
      void (async () => {
        if (key.ctrl && key.name === "c") {
          state.done = true;
          state.saved = false;
          await finish();
          return;
        }

        const textItem = key.name === "return" || key.name === "enter" ? currentTextItem(state) : undefined;
        if (textItem) {
          input.off("keypress", onKeypress);
          await editTextSetting(state, textItem.id, input, output);
          input.on("keypress", onKeypress);
          flushRender();
          return;
        }

        handleKey(state, key.name ?? "");

        if (state.done) {
          await finish();
          return;
        }
        requestRender();
      })().catch((error) => {
        cleanup();
        reject(error);
      });
    };

    output.write("\x1b[?1049h\x1b[?25l");
    flushRender();
    input.on("keypress", onKeypress);
  });
}

export function summarizeSettings(settings: RepoVistaSettings): string[] {
  const provider = getReportProvider(selectedProvider(settings));
  return [
    `Provider: ${provider.displayName}`,
    `Parallel mode: ${formatParallel(effectiveParallel(settings))}`,
    `Audit profile: ${settings.auditProfile ?? "none"}`,
    `Review mode: ${effectiveReviewMode(settings)}`,
    `Model: ${settings.model ?? `${provider.displayName} default`}`,
    `Reasoning: ${effectiveReasoning(settings) ?? "model default"}`,
    `Codex profile: ${settings.profile ?? "none"}`,
    `Codex fast mode: ${effectiveBoolean(settings, "fastMode") ? "on" : "off"}`,
    `Sandbox: ${settings.sandbox ?? DEFAULT_OPTIONS.sandbox}`,
    `Language: ${settings.language ?? DEFAULT_OPTIONS.language}`,
    `Output directory: ${settings.outDir ?? DEFAULT_OPTIONS.outDir}`,
    `Prompt file: ${settings.promptFile ?? "none"}`,
    `Workspace: ${settings.workspace ?? "all"}`,
    `All workspaces: ${effectiveBoolean(settings, "allWorkspaces") ? "on" : "off"}`,
    `Incremental scan cache: ${effectiveBoolean(settings, "incremental") ? "on" : "off"}`,
    `Include patterns: ${formatArray(settings.includes)}`,
    `Ignore patterns: ${formatArray(settings.ignores)}`,
    `Run checks: ${effectiveBoolean(settings, "runChecks") ? "on" : "off"}`,
    `Check commands: ${formatArray(settings.checkCommands)}`,
    `Check timeout: ${formatSeconds(settings.checkTimeoutSeconds ?? DEFAULT_OPTIONS.checkTimeoutSeconds)}`,
    `Provider phase timeout: ${formatSeconds(settings.phaseTimeoutSeconds ?? DEFAULT_OPTIONS.phaseTimeoutSeconds)}`,
    `Strict report gates: ${effectiveBoolean(settings, "strictReports") ? "on" : "off"}`,
    `Repair reports: ${effectiveBoolean(settings, "repairReports") ? "on" : "off"}`,
    `Deep review: ${effectiveBoolean(settings, "deepReview") ? "on" : "off"}`,
    `Export formats: ${formatArray(effectiveExportFormats(settings))}`,
    `JSON: ${effectiveBoolean(settings, "json") ? "on" : "off"}`,
    `Keep logs: ${effectiveBoolean(settings, "keepLogs") ? "on" : "off"}`,
    `Progress output: ${effectiveBoolean(settings, "progress") ? "on" : "reduced"}`,
    `CI mode: ${effectiveBoolean(settings, "ci") ? "on" : "off"}`,
    `Fail on critical: ${effectiveBoolean(settings, "failOnCritical") ? "on" : "off"}`
  ];
}

function handleKey(state: MenuState, keyName: string): void {
  const itemCount = currentItems(state).length;

  if (!itemCount) {
    if (keyName === "escape" || keyName === "backspace" || keyName === "return" || keyName === "enter") {
      state.screen = "main";
      state.cursor = 0;
    }
    return;
  }

  if (keyName === "up") {
    state.cursor = (state.cursor - 1 + itemCount) % itemCount;
    return;
  }

  if (keyName === "down") {
    state.cursor = (state.cursor + 1) % itemCount;
    return;
  }

  if (keyName === "escape" || keyName === "backspace") {
    state.screen = "main";
    state.cursor = 0;
    return;
  }

  if (keyName === "space") {
    toggleCurrentSelection(state);
    return;
  }

  if (keyName === "return" || keyName === "enter") {
    activateCurrentItem(state);
  }
}

function activateCurrentItem(state: MenuState): void {
  if (state.screen !== "main") {
    state.screen = "main";
    state.cursor = 0;
    return;
  }

  const item = MAIN_ITEMS[state.cursor];
  switch (item.id) {
    case "provider":
    case "parallel":
    case "auditProfile":
    case "reviewMode":
    case "model":
    case "reasoning":
    case "fastMode":
    case "sandbox":
    case "language":
    case "checkTimeout":
    case "phaseTimeout":
    case "checkCommands":
    case "exportFormats":
      state.screen = item.id;
      state.cursor = 0;
      break;
    case "runChecks":
    case "json":
    case "keepLogs":
    case "progress":
    case "ci":
    case "failOnCritical":
    case "strictReports":
    case "repairReports":
    case "deepReview":
    case "allWorkspaces":
    case "incremental":
      toggleBoolean(state, item.id);
      break;
    case "profile":
    case "workspace":
    case "outDir":
    case "promptFile":
    case "includes":
    case "ignores":
      break;
    case "save":
      state.done = true;
      state.saved = true;
      break;
    case "exit":
      state.done = true;
      state.saved = false;
      break;
  }
}

function toggleCurrentSelection(state: MenuState): void {
  if (state.screen === "main") {
    const item = MAIN_ITEMS[state.cursor];
    if (item.type === "toggle") {
      toggleBoolean(state, item.id);
    }
    return;
  }

  if (state.screen === "provider") {
    const selected = REPORT_PROVIDER_IDS[state.cursor];
    if (selected && selected !== DEFAULT_OPTIONS.provider && state.settings.provider !== selected) {
      state.settings.provider = selected;
      state.settings.model = undefined;
      state.settings.reasoning = undefined;
    } else {
      state.settings.provider = undefined;
      state.settings.model = undefined;
      state.settings.reasoning = undefined;
    }
    return;
  }

  if (state.screen === "parallel") {
    const selected = PARALLEL_OPTIONS[state.cursor];
    state.settings.parallel = selected === DEFAULT_OPTIONS.parallel || state.settings.parallel === selected ? undefined : selected;
    return;
  }

  if (state.screen === "auditProfile") {
    const selected = AUDIT_PROFILES[state.cursor]?.id;
    state.settings.auditProfile = state.settings.auditProfile === selected ? undefined : selected;
    return;
  }

  if (state.screen === "reviewMode") {
    const selected = REVIEW_MODE_OPTIONS[state.cursor];
    state.settings.reviewMode = selected === DEFAULT_OPTIONS.reviewMode || state.settings.reviewMode === selected ? undefined : selected;
    return;
  }

  if (state.screen === "model") {
    const models = currentModels(state);
    const selected = models[state.cursor]?.slug;
    state.settings.model = state.settings.model === selected ? undefined : selected;
    if (state.settings.model && state.settings.reasoning) {
      const supported = reasoningOptionsForProviderModel(selectedProvider(state.settings), models, state.settings.model).map((item) => item.effort);
      if (!supported.includes(state.settings.reasoning)) {
        state.settings.reasoning = undefined;
      }
    }
    return;
  }

  if (state.screen === "reasoning") {
    const provider = selectedProvider(state.settings);
    const selected = reasoningOptionsForProviderModel(provider, currentModels(state), state.settings.model)[state.cursor]?.effort;
    state.settings.reasoning = selected === DEFAULT_OPTIONS.reasoning || state.settings.reasoning === selected ? undefined : selected;
    return;
  }

  if (state.screen === "fastMode") {
    setBooleanOverride(state.settings, "fastMode", FAST_MODE_OPTIONS[state.cursor] === "on");
    return;
  }

  if (state.screen === "sandbox") {
    const selected = SANDBOX_OPTIONS[state.cursor];
    state.settings.sandbox = selected === DEFAULT_OPTIONS.sandbox || state.settings.sandbox === selected ? undefined : selected;
    return;
  }

  if (state.screen === "language") {
    const selected = LANGUAGE_OPTIONS[state.cursor];
    state.settings.language = selected === DEFAULT_OPTIONS.language || state.settings.language === selected ? undefined : selected;
    return;
  }

  if (state.screen === "checkCommands") {
    const selected = state.checkCommandOptions[state.cursor];
    if (selected) {
      state.settings.checkCommands = toggleListValue(state.settings.checkCommands, selected);
    }
    return;
  }

  if (state.screen === "exportFormats") {
    const selected = EXPORT_FORMAT_OPTIONS[state.cursor];
    if (selected) {
      setExportFormatsOverride(state.settings, toggleListValue(effectiveExportFormats(state.settings), selected) ?? []);
    }
    return;
  }

  if (state.screen === "checkTimeout") {
    const selected = CHECK_TIMEOUT_OPTIONS[state.cursor];
    state.settings.checkTimeoutSeconds = selected === DEFAULT_OPTIONS.checkTimeoutSeconds || state.settings.checkTimeoutSeconds === selected ? undefined : selected;
    return;
  }

  if (state.screen === "phaseTimeout") {
    const selected = PHASE_TIMEOUT_OPTIONS[state.cursor];
    state.settings.phaseTimeoutSeconds = selected === DEFAULT_OPTIONS.phaseTimeoutSeconds || state.settings.phaseTimeoutSeconds === selected ? undefined : selected;
  }
}

function toggleBoolean(state: MenuState, key: keyof RepoVistaSettings): void {
  setBooleanOverride(state.settings, key, !effectiveBoolean(state.settings, key));
}

function render(state: MenuState, output: WriteStream): void {
  const frame = buildSettingsMenuFrame(state, {
    columns: output.columns ?? 100,
    rows: output.rows ?? 30,
    color: shouldUseColor(output)
  });
  if (frame === state.lastFrame) {
    return;
  }
  state.lastFrame = frame;
  output.write(renderSettingsTerminalFrame(frame));
}

export function renderSettingsMenuFrame(
  settings: RepoVistaSettings,
  options: {
    screen?: MenuScreen;
    cursor?: number;
    modelsByProvider?: Partial<Record<AiProviderId, ProviderModelInfo[]>>;
    checkCommandOptions?: string[];
    columns?: number;
    rows?: number;
    color?: boolean;
  } = {}
): string {
  const state: MenuState = {
    screen: options.screen ?? "main",
    cursor: options.cursor ?? 0,
    settings,
    modelsByProvider: Object.fromEntries(REPORT_PROVIDER_IDS.map((providerId) => [
      providerId,
      options.modelsByProvider?.[providerId] ?? []
    ])) as Record<AiProviderId, ProviderModelInfo[]>,
    checkCommandOptions: options.checkCommandOptions ?? [],
    done: false,
    saved: false,
    settingsPath: ""
  };
  return buildSettingsMenuFrame(state, {
    columns: options.columns ?? 100,
    rows: options.rows ?? 30,
    color: options.color ?? false
  });
}

export function renderSettingsTerminalFrame(frame: string): string {
  const clearedLines = frame
    .split("\n")
    .map((line) => `${line}\x1b[K`)
    .join("\n");
  return `\x1b[H${clearedLines}\x1b[J`;
}

function buildSettingsMenuFrame(state: MenuState, options: { columns: number; rows: number; color: boolean }): string {
  const columns = Math.max(40, options.columns);
  const rows = Math.max(12, options.rows);
  const items = currentItems(state);
  const header = renderHeader(state, options.color);
  const footer = renderFooter(state, items.length, options.color);
  const availableRows = Math.max(4, rows - header.length - footer.length);
  const start = visibleStart(state.cursor, items.length, availableRows);
  const visibleItems = items.slice(start, start + availableRows);
  const lines = [...header];

  if (!items.length) {
    lines.push(colorize("  No options available. Press Enter to return.", ANSI.dim, options.color));
  } else {
    for (let offset = 0; offset < visibleItems.length; offset += 1) {
      const index = start + offset;
      lines.push(renderMenuLine(visibleItems[offset] ?? "", index === state.cursor, columns, options.color));
    }
  }

  lines.push(...footer);
  return lines.join("\n");
}

function renderHeader(state: MenuState, useColor: boolean): string[] {
  const title = colorize("RepoVista Settings", `${ANSI.bold}${ANSI.cyan}`, useColor);
  const help = colorize("Arrow keys move | Space toggles/selects | Enter opens/returns | Esc returns | Ctrl+C exits", ANSI.dim, useColor);
  return [
    title,
    help,
    colorize(screenTitle(state.screen), ANSI.yellow, useColor),
    ""
  ];
}

function renderFooter(state: MenuState, itemCount: number, useColor: boolean): string[] {
  const position = itemCount ? `${Math.min(state.cursor + 1, itemCount)}/${itemCount}` : "0/0";
  const action = state.screen === "main"
    ? "Enter opens or edits, Space toggles, Save and exit writes settings"
    : "Space selects or clears, Enter returns to the main menu";
  return [
    "",
    colorize(`${position} | ${action}`, ANSI.dim, useColor)
  ];
}

function renderMenuLine(rawItem: string, active: boolean, columns: number, useColor: boolean): string {
  const marker = active ? ">" : " ";
  const label = truncatePlain(rawItem, Math.max(8, columns - 4));
  if (active) {
    return `${colorize(marker, ANSI.cyan, useColor)} ${colorize(` ${label} `, `${ANSI.bgCyan}${ANSI.white}`, useColor)}`;
  }
  return `${colorize(marker, ANSI.gray, useColor)} ${styleMenuItem(label, useColor)}`;
}

function styleMenuItem(label: string, useColor: boolean): string {
  if (!useColor) {
    return label;
  }
  if (label.startsWith("[x]")) {
    return `${colorize("[x]", ANSI.green, true)}${label.slice(3)}`;
  }
  if (label.startsWith("[ ]")) {
    return `${colorize("[ ]", ANSI.gray, true)}${colorize(label.slice(3), ANSI.dim, true)}`;
  }
  if (label === "Save and exit") {
    return colorize(label, ANSI.green, true);
  }
  if (label === "Exit without saving") {
    return colorize(label, ANSI.yellow, true);
  }

  const separator = label.indexOf(":");
  if (separator > 0) {
    return `${colorize(label.slice(0, separator + 1), ANSI.cyan, true)}${label.slice(separator + 1)}`;
  }
  return label;
}

function visibleStart(cursor: number, itemCount: number, visibleRows: number): number {
  if (itemCount <= visibleRows) {
    return 0;
  }
  const preferred = cursor - Math.floor(visibleRows / 2);
  return Math.min(Math.max(0, preferred), itemCount - visibleRows);
}

function screenTitle(screen: MenuScreen): string {
  switch (screen) {
    case "main":
      return "Default settings";
    case "provider":
      return "Provider";
    case "parallel":
      return "Parallel execution";
    case "auditProfile":
      return "Audit profile";
    case "reviewMode":
      return "Review mode";
    case "model":
      return "Model";
    case "reasoning":
      return "Reasoning";
    case "fastMode":
      return "Fast mode";
    case "sandbox":
      return "Sandbox";
    case "language":
      return "Language";
    case "checkCommands":
      return "Check commands";
    case "exportFormats":
      return "Export formats";
    case "checkTimeout":
      return "Check timeout";
    case "phaseTimeout":
      return "Provider phase timeout";
  }
}

function truncatePlain(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function colorize(value: string, code: string, useColor: boolean): string {
  return useColor ? `${code}${value}${ANSI.reset}` : value;
}

function shouldUseColor(output: WriteStream): boolean {
  return Boolean(output.isTTY && !process.env.NO_COLOR && process.env.TERM !== "dumb");
}

function currentItems(state: MenuState): string[] {
  switch (state.screen) {
    case "provider":
      return REPORT_PROVIDER_IDS.map((providerId) => {
        const provider = getReportProvider(providerId);
        return checkbox(providerId === selectedProvider(state.settings), `${provider.displayName} (${providerId})`);
      });
    case "parallel":
      return PARALLEL_OPTIONS.map((parallel) => checkbox(parallel === effectiveParallel(state.settings), formatParallel(parallel)));
    case "auditProfile":
      return AUDIT_PROFILES.map((profile) => checkbox(profile.id === state.settings.auditProfile, `${profile.id} - ${profile.description}`));
    case "reviewMode":
      return REVIEW_MODE_OPTIONS.map((mode) => checkbox(mode === effectiveReviewMode(state.settings), mode));
    case "model":
      return currentModels(state).map((model) => checkbox(model.slug === state.settings.model, `${model.displayName} (${model.slug})${model.supportsFastMode ? " [fast]" : ""}`));
    case "reasoning":
      return reasoningOptionsForProviderModel(selectedProvider(state.settings), currentModels(state), state.settings.model).map((level) => checkbox(level.effort === effectiveReasoning(state.settings), `${level.effort}${level.description ? ` - ${level.description}` : ""}`));
    case "fastMode":
      return FAST_MODE_OPTIONS.map((mode) => checkbox((effectiveBoolean(state.settings, "fastMode") ? "on" : "off") === mode, mode));
    case "sandbox":
      return SANDBOX_OPTIONS.map((sandbox) => checkbox(sandbox === (state.settings.sandbox ?? DEFAULT_OPTIONS.sandbox), sandbox));
    case "language":
      return LANGUAGE_OPTIONS.map((language) => checkbox(language === (state.settings.language ?? DEFAULT_OPTIONS.language), language));
    case "checkCommands":
      return state.checkCommandOptions.map((command) => checkbox(Boolean(state.settings.checkCommands?.includes(command)), command));
    case "exportFormats":
      return EXPORT_FORMAT_OPTIONS.map((format) => checkbox(effectiveExportFormats(state.settings).includes(format), format));
    case "checkTimeout":
      return CHECK_TIMEOUT_OPTIONS.map((seconds) => checkbox(seconds === (state.settings.checkTimeoutSeconds ?? DEFAULT_OPTIONS.checkTimeoutSeconds), formatSeconds(seconds)));
    case "phaseTimeout":
      return PHASE_TIMEOUT_OPTIONS.map((seconds) => checkbox(seconds === (state.settings.phaseTimeoutSeconds ?? DEFAULT_OPTIONS.phaseTimeoutSeconds), formatSeconds(seconds)));
    case "main":
      return MAIN_ITEMS.map((item) => item.label(state.settings));
  }
}

function currentTextItem(state: MenuState): Extract<MainItem, { type: "text" }> | undefined {
  if (state.screen !== "main") {
    return undefined;
  }

  const item = MAIN_ITEMS[state.cursor];
  return item.type === "text" ? item : undefined;
}

async function editTextSetting(
  state: MenuState,
  id: Extract<MainItem, { type: "text" }>["id"],
  input: ReadStream,
  output: WriteStream
): Promise<void> {
  const current = textValueForSetting(state.settings, id);
  const label = textLabel(id);
  const answer = await promptForText(input, output, `${label}${current ? ` [${current}]` : ""}`);
  const trimmed = answer.trim();

  if (id === "profile" || id === "outDir" || id === "workspace" || id === "promptFile") {
    state.settings[id] = trimmed || undefined;
    return;
  }

  const values = splitList(trimmed);
  if (id === "includes") {
    state.settings.includes = values.length ? values : undefined;
  }
  if (id === "ignores") {
    state.settings.ignores = values.length ? values : undefined;
  }
}

function promptForText(input: ReadStream, output: WriteStream, label: string): Promise<string> {
  input.setRawMode(false);
  input.resume();
  output.write("\x1b[?25h\n");

  const rl = readline.createInterface({ input, output });
  return new Promise((resolve) => {
    rl.question(`${label}: `, (answer) => {
      rl.close();
      input.setRawMode(true);
      input.resume();
      output.write("\x1b[?25l");
      resolve(answer);
    });
  });
}

function textValueForSetting(settings: RepoVistaSettings, id: Extract<MainItem, { type: "text" }>["id"]): string {
  if (id === "profile" || id === "outDir" || id === "workspace" || id === "promptFile") {
    return settings[id] ?? "";
  }
  if (id === "includes") {
    return (settings.includes ?? []).join(", ");
  }
  if (id === "ignores") {
    return (settings.ignores ?? []).join(", ");
  }
  return "";
}

function textLabel(id: Extract<MainItem, { type: "text" }>["id"]): string {
  switch (id) {
    case "profile":
      return "Codex profile, empty clears";
    case "workspace":
      return "Workspace name or path, empty audits all";
    case "outDir":
      return "Output directory, empty clears";
    case "promptFile":
      return "Prompt guidance file, empty clears";
    case "includes":
      return "Include patterns, comma-separated, empty clears";
    case "ignores":
      return "Ignore patterns, comma-separated, empty clears";
  }
}

function selectedProvider(settings: RepoVistaSettings): AiProviderId {
  return settings.provider ?? DEFAULT_OPTIONS.provider;
}

function effectiveParallel(settings: RepoVistaSettings): ParallelMode {
  return settings.parallel ?? DEFAULT_OPTIONS.parallel;
}

function effectiveReviewMode(settings: RepoVistaSettings): ReviewMode {
  return settings.reviewMode ?? DEFAULT_OPTIONS.reviewMode ?? "default";
}

function effectiveReasoning(settings: RepoVistaSettings): string | undefined {
  return settings.reasoning ?? DEFAULT_OPTIONS.reasoning;
}

function effectiveExportFormats(settings: RepoVistaSettings): ReportExportFormat[] {
  return settings.exportFormats ?? DEFAULT_OPTIONS.exportFormats;
}

function effectiveBoolean(settings: RepoVistaSettings, key: keyof RepoVistaSettings): boolean {
  const value = settings[key];
  if (typeof value === "boolean") {
    return value;
  }
  const defaultValue = DEFAULT_OPTIONS[key as keyof typeof DEFAULT_OPTIONS];
  return typeof defaultValue === "boolean" ? defaultValue : false;
}

function setBooleanOverride(settings: RepoVistaSettings, key: keyof RepoVistaSettings, value: boolean): void {
  const defaultValue = DEFAULT_OPTIONS[key as keyof typeof DEFAULT_OPTIONS];
  settings[key] = value === defaultValue ? undefined as never : value as never;
}

function setExportFormatsOverride(settings: RepoVistaSettings, values: ReportExportFormat[]): void {
  settings.exportFormats = sameArray(values, DEFAULT_OPTIONS.exportFormats) ? undefined : values;
}

function sameArray(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function currentModels(state: MenuState): ProviderModelInfo[] {
  return state.modelsByProvider[selectedProvider(state.settings)] ?? [];
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function toggleListValue<T extends string>(current: T[] | undefined, value: T): T[] | undefined {
  const values = new Set(current ?? []);
  if (values.has(value)) {
    values.delete(value);
  } else {
    values.add(value);
  }
  return values.size ? Array.from(values) : undefined;
}

async function loadCheckCommandOptions(projectRoot: string): Promise<string[]> {
  const defaults = ["npm test", "npm run typecheck", "npm run lint", "npm audit --audit-level=moderate"];
  try {
    const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8")) as { scripts?: Record<string, unknown> };
    const scripts = packageJson.scripts && typeof packageJson.scripts === "object" ? packageJson.scripts : {};
    const scriptCommands = Object.keys(scripts)
      .filter((name) => /^(test|lint|typecheck|check|build|security:audit|audit)$/.test(name))
      .map((name) => `npm run ${name}`);
    return Array.from(new Set([...scriptCommands, ...defaults]));
  } catch {
    return defaults;
  }
}

function checkbox(selected: boolean, label: string): string {
  return `[${selected ? "x" : " "}] ${label}`;
}

function formatArray(values: string[] | undefined): string {
  return values?.length ? values.join(", ") : "none";
}

function formatSeconds(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = seconds / 60;
  return Number.isInteger(minutes) ? `${minutes}m` : `${minutes.toFixed(1)}m`;
}

function formatParallel(parallel: ParallelMode): string {
  return typeof parallel === "number" ? `${parallel} threads` : parallel;
}

const MAIN_ITEMS: readonly MainItem[] = [
  { id: "provider", type: "submenu", label: (settings) => `Provider: ${getReportProvider(selectedProvider(settings)).displayName}` },
  { id: "parallel", type: "submenu", label: (settings) => `Parallel mode: ${formatParallel(effectiveParallel(settings))}` },
  { id: "auditProfile", type: "submenu", label: (settings) => `Audit profile: ${settings.auditProfile ?? "none"}` },
  { id: "reviewMode", type: "submenu", label: (settings) => `Review mode: ${effectiveReviewMode(settings)}` },
  { id: "model", type: "submenu", label: (settings) => `Model: ${settings.model ?? `${getReportProvider(selectedProvider(settings)).displayName} default`}` },
  { id: "reasoning", type: "submenu", label: (settings) => `Reasoning: ${effectiveReasoning(settings) ?? "model default"}` },
  { id: "fastMode", type: "submenu", label: (settings) => `Fast mode: ${effectiveBoolean(settings, "fastMode") ? "on" : "off"}` },
  { id: "profile", type: "text", label: (settings) => `Codex profile: ${settings.profile ?? "none"}` },
  { id: "sandbox", type: "submenu", label: (settings) => `Sandbox: ${settings.sandbox ?? DEFAULT_OPTIONS.sandbox}` },
  { id: "language", type: "submenu", label: (settings) => `Language: ${settings.language ?? DEFAULT_OPTIONS.language}` },
  { id: "outDir", type: "text", label: (settings) => `Output directory: ${settings.outDir ?? DEFAULT_OPTIONS.outDir}` },
  { id: "promptFile", type: "text", label: (settings) => `Prompt file: ${settings.promptFile ?? "none"}` },
  { id: "workspace", type: "text", label: (settings) => `Workspace: ${settings.workspace ?? "all"}` },
  { id: "allWorkspaces", type: "toggle", label: (settings) => checkbox(effectiveBoolean(settings, "allWorkspaces"), "Record all detected workspaces") },
  { id: "incremental", type: "toggle", label: (settings) => checkbox(effectiveBoolean(settings, "incremental"), "Incremental scan cache") },
  { id: "includes", type: "text", label: (settings) => `Include patterns: ${formatArray(settings.includes)}` },
  { id: "ignores", type: "text", label: (settings) => `Ignore patterns: ${formatArray(settings.ignores)}` },
  { id: "runChecks", type: "toggle", label: (settings) => checkbox(effectiveBoolean(settings, "runChecks"), "Run local checks before analysis") },
  { id: "checkCommands", type: "submenu", label: (settings) => `Check commands: ${formatArray(settings.checkCommands)}` },
  { id: "checkTimeout", type: "submenu", label: (settings) => `Check timeout: ${formatSeconds(settings.checkTimeoutSeconds ?? DEFAULT_OPTIONS.checkTimeoutSeconds)}` },
  { id: "phaseTimeout", type: "submenu", label: (settings) => `Provider phase timeout: ${formatSeconds(settings.phaseTimeoutSeconds ?? DEFAULT_OPTIONS.phaseTimeoutSeconds)}` },
  { id: "strictReports", type: "toggle", label: (settings) => checkbox(effectiveBoolean(settings, "strictReports"), "Strict report quality gates") },
  { id: "repairReports", type: "toggle", label: (settings) => checkbox(effectiveBoolean(settings, "repairReports"), "Repair reports that miss quality gates") },
  { id: "deepReview", type: "toggle", label: (settings) => checkbox(effectiveBoolean(settings, "deepReview"), "Feature-sliced deep review") },
  { id: "exportFormats", type: "submenu", label: (settings) => `Export formats: ${formatArray(effectiveExportFormats(settings))}` },
  { id: "json", type: "toggle", label: (settings) => checkbox(effectiveBoolean(settings, "json"), "JSON metadata and provider logs") },
  { id: "keepLogs", type: "toggle", label: (settings) => checkbox(effectiveBoolean(settings, "keepLogs"), "Keep technical logs") },
  { id: "progress", type: "toggle", label: (settings) => checkbox(effectiveBoolean(settings, "progress"), "Progress output") },
  { id: "ci", type: "toggle", label: (settings) => checkbox(effectiveBoolean(settings, "ci"), "CI mode") },
  { id: "failOnCritical", type: "toggle", label: (settings) => checkbox(effectiveBoolean(settings, "failOnCritical"), "Fail on critical findings") },
  { id: "save", type: "command", label: () => "Save and exit" },
  { id: "exit", type: "command", label: () => "Exit without saving" }
];

export const SETTINGS_MENU_ITEM_IDS = MAIN_ITEMS.map((item) => item.id);

export function assertSettingsMenuRegistryCoverage(): string[] {
  const registryIds = menuItemIdsFromRegistry();
  return MAIN_ITEMS
    .map((item) => item.id)
    .filter((id) => id !== "save" && id !== "exit" && !registryIds.has(id));
}
