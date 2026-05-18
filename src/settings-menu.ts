import readline from "node:readline";
import type { ReadStream, WriteStream } from "node:tty";
import { RepoVistaError } from "./errors.js";
import { loadCodexModels, reasoningOptionsForModel, type CodexModelInfo } from "./codex-models.js";
import { getSettingsPath, loadSettings, saveSettings, type RepoVistaSettings } from "./settings-config.js";
import type { SandboxMode } from "./types.js";

type MenuScreen = "main" | "model" | "reasoning" | "sandbox" | "language" | "checkTimeout" | "phaseTimeout";

interface MenuState {
  screen: MenuScreen;
  cursor: number;
  settings: RepoVistaSettings;
  models: CodexModelInfo[];
  done: boolean;
  saved: boolean;
  settingsPath: string;
}

type MainItem =
  | { id: "model" | "reasoning" | "sandbox" | "language" | "checkTimeout" | "phaseTimeout"; type: "submenu"; label: (settings: RepoVistaSettings) => string }
  | { id: "fastMode" | "runChecks" | "json" | "keepLogs" | "progress" | "ci" | "failOnCritical" | "strictReports"; type: "toggle"; label: (settings: RepoVistaSettings) => string }
  | { id: "profile" | "outDir" | "includes" | "ignores" | "checkCommands"; type: "text"; label: (settings: RepoVistaSettings) => string }
  | { id: "save" | "exit"; type: "command"; label: () => string };

const LANGUAGE_OPTIONS = ["English", "German", "Spanish", "French", "Italian", "Portuguese"];
const SANDBOX_OPTIONS: SandboxMode[] = ["read-only", "workspace-write"];
const CHECK_TIMEOUT_OPTIONS = [60, 300, 600, 900, 1800, 3600];
const PHASE_TIMEOUT_OPTIONS = [900, 1800, 3600, 5400, 7200];

export async function runSettingsMenu(
  input = process.stdin as ReadStream,
  output = process.stdout as WriteStream
): Promise<RepoVistaSettings> {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
    throw new RepoVistaError("The settings command requires an interactive terminal.", "SETTINGS_NOT_INTERACTIVE");
  }

  const settingsPath = getSettingsPath();
  const settings = await loadSettings(settingsPath);
  const models = await loadCodexModels();
  const state: MenuState = {
    screen: "main",
    cursor: 0,
    settings,
    models,
    done: false,
    saved: false,
    settingsPath
  };

  readline.emitKeypressEvents(input);
  input.setRawMode(true);
  input.resume();

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      input.off("keypress", onKeypress);
      input.setRawMode(false);
      input.pause();
      output.write("\x1b[?25h");
    };

    const finish = async () => {
      try {
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
          render(state, output);
          return;
        }

        handleKey(state, key.name ?? "");
        render(state, output);

        if (state.done) {
          await finish();
        }
      })().catch((error) => {
        cleanup();
        reject(error);
      });
    };

    output.write("\x1b[?25l");
    render(state, output);
    input.on("keypress", onKeypress);
  });
}

export function summarizeSettings(settings: RepoVistaSettings): string[] {
  return [
    `Model: ${settings.model ?? "Codex default"}`,
    `Reasoning: ${settings.reasoning ?? "model default"}`,
    `Profile: ${settings.profile ?? "none"}`,
    `Fast mode: ${settings.fastMode ? "on" : "off"}`,
    `Sandbox: ${settings.sandbox ?? "read-only"}`,
    `Language: ${settings.language ?? "English"}`,
    `Output directory: ${settings.outDir ?? ".repovista"}`,
    `Include patterns: ${formatArray(settings.includes)}`,
    `Ignore patterns: ${formatArray(settings.ignores)}`,
    `Run checks: ${settings.runChecks ? "on" : "off"}`,
    `Check commands: ${formatArray(settings.checkCommands)}`,
    `Check timeout: ${formatSeconds(settings.checkTimeoutSeconds ?? 300)}`,
    `Codex phase timeout: ${formatSeconds(settings.phaseTimeoutSeconds ?? 1800)}`,
    `Strict report gates: ${settings.strictReports ? "on" : "off"}`,
    `JSON: ${settings.json ? "on" : "off"}`,
    `Keep logs: ${settings.keepLogs ? "on" : "off"}`,
    `Progress output: ${settings.progress === false ? "reduced" : "on"}`,
    `CI mode: ${settings.ci ? "on" : "off"}`,
    `Fail on critical: ${settings.failOnCritical ? "on" : "off"}`
  ];
}

function handleKey(state: MenuState, keyName: string): void {
  const itemCount = currentItems(state).length;

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
    case "model":
    case "reasoning":
    case "sandbox":
    case "language":
    case "checkTimeout":
    case "phaseTimeout":
      state.screen = item.id;
      state.cursor = 0;
      break;
    case "fastMode":
    case "runChecks":
    case "json":
    case "keepLogs":
    case "progress":
    case "ci":
    case "failOnCritical":
    case "strictReports":
      toggleBoolean(state, item.id);
      break;
    case "profile":
    case "outDir":
    case "includes":
    case "ignores":
    case "checkCommands":
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

  if (state.screen === "model") {
    const selected = state.models[state.cursor]?.slug;
    state.settings.model = state.settings.model === selected ? undefined : selected;
    if (state.settings.model && state.settings.reasoning) {
      const supported = reasoningOptionsForModel(state.models, state.settings.model).map((item) => item.effort);
      if (!supported.includes(state.settings.reasoning)) {
        state.settings.reasoning = undefined;
      }
    }
    return;
  }

  if (state.screen === "reasoning") {
    const selected = reasoningOptionsForModel(state.models, state.settings.model)[state.cursor]?.effort;
    state.settings.reasoning = state.settings.reasoning === selected ? undefined : selected;
    return;
  }

  if (state.screen === "sandbox") {
    const selected = SANDBOX_OPTIONS[state.cursor];
    state.settings.sandbox = state.settings.sandbox === selected ? undefined : selected;
    return;
  }

  if (state.screen === "language") {
    const selected = LANGUAGE_OPTIONS[state.cursor];
    state.settings.language = state.settings.language === selected ? undefined : selected;
    return;
  }

  if (state.screen === "checkTimeout") {
    const selected = CHECK_TIMEOUT_OPTIONS[state.cursor];
    state.settings.checkTimeoutSeconds = state.settings.checkTimeoutSeconds === selected ? undefined : selected;
    return;
  }

  if (state.screen === "phaseTimeout") {
    const selected = PHASE_TIMEOUT_OPTIONS[state.cursor];
    state.settings.phaseTimeoutSeconds = state.settings.phaseTimeoutSeconds === selected ? undefined : selected;
  }
}

function toggleBoolean(state: MenuState, key: keyof RepoVistaSettings): void {
  state.settings[key] = !state.settings[key] as never;
}

function render(state: MenuState, output: WriteStream): void {
  output.write("\x1b[2J\x1b[H");
  output.write("RepoVista Settings\n\n");
  output.write("Use arrow keys to move, Space to select or clear, Enter to edit/return/save.\n\n");

  if (state.screen === "main") {
    for (const line of summarizeSettings(state.settings)) {
      output.write(`  ${line}\n`);
    }
    output.write("\n");
  }

  const items = currentItems(state);
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const marker = index === state.cursor ? ">" : " ";
    output.write(`${marker} ${item}\n`);
  }
}

function currentItems(state: MenuState): string[] {
  switch (state.screen) {
    case "model":
      return state.models.map((model) => checkbox(model.slug === state.settings.model, `${model.displayName} (${model.slug})${model.supportsFastMode ? " [fast]" : ""}`));
    case "reasoning":
      return reasoningOptionsForModel(state.models, state.settings.model).map((level) => checkbox(level.effort === state.settings.reasoning, `${level.effort}${level.description ? ` - ${level.description}` : ""}`));
    case "sandbox":
      return SANDBOX_OPTIONS.map((sandbox) => checkbox(sandbox === state.settings.sandbox, sandbox));
    case "language":
      return LANGUAGE_OPTIONS.map((language) => checkbox(language === state.settings.language, language));
    case "checkTimeout":
      return CHECK_TIMEOUT_OPTIONS.map((seconds) => checkbox(seconds === state.settings.checkTimeoutSeconds, formatSeconds(seconds)));
    case "phaseTimeout":
      return PHASE_TIMEOUT_OPTIONS.map((seconds) => checkbox(seconds === state.settings.phaseTimeoutSeconds, formatSeconds(seconds)));
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

  if (id === "profile" || id === "outDir") {
    state.settings[id] = trimmed || undefined;
    return;
  }

  const values = splitList(trimmed);
  if (id === "includes") {
    state.settings.includes = values.length ? values : undefined;
  } else if (id === "ignores") {
    state.settings.ignores = values.length ? values : undefined;
  } else {
    state.settings.checkCommands = values.length ? values : undefined;
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
  if (id === "profile" || id === "outDir") {
    return settings[id] ?? "";
  }
  if (id === "includes") {
    return (settings.includes ?? []).join(", ");
  }
  if (id === "ignores") {
    return (settings.ignores ?? []).join(", ");
  }
  return (settings.checkCommands ?? []).join(", ");
}

function textLabel(id: Extract<MainItem, { type: "text" }>["id"]): string {
  switch (id) {
    case "profile":
      return "Codex profile, empty clears";
    case "outDir":
      return "Output directory, empty clears";
    case "includes":
      return "Include patterns, comma-separated, empty clears";
    case "ignores":
      return "Ignore patterns, comma-separated, empty clears";
    case "checkCommands":
      return "Check commands, comma-separated, empty clears";
  }
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
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

const MAIN_ITEMS: readonly MainItem[] = [
  { id: "model", type: "submenu", label: (settings) => `Model: ${settings.model ?? "Codex default"}` },
  { id: "reasoning", type: "submenu", label: (settings) => `Reasoning: ${settings.reasoning ?? "model default"}` },
  { id: "profile", type: "text", label: (settings) => `Profile: ${settings.profile ?? "none"}` },
  { id: "fastMode", type: "toggle", label: (settings) => checkbox(Boolean(settings.fastMode), "Fast mode") },
  { id: "sandbox", type: "submenu", label: (settings) => `Sandbox: ${settings.sandbox ?? "read-only"}` },
  { id: "language", type: "submenu", label: (settings) => `Language: ${settings.language ?? "English"}` },
  { id: "outDir", type: "text", label: (settings) => `Output directory: ${settings.outDir ?? ".repovista"}` },
  { id: "includes", type: "text", label: (settings) => `Include patterns: ${formatArray(settings.includes)}` },
  { id: "ignores", type: "text", label: (settings) => `Ignore patterns: ${formatArray(settings.ignores)}` },
  { id: "runChecks", type: "toggle", label: (settings) => checkbox(Boolean(settings.runChecks), "Run local checks before Codex") },
  { id: "checkCommands", type: "text", label: (settings) => `Check commands: ${formatArray(settings.checkCommands)}` },
  { id: "checkTimeout", type: "submenu", label: (settings) => `Check timeout: ${formatSeconds(settings.checkTimeoutSeconds ?? 300)}` },
  { id: "phaseTimeout", type: "submenu", label: (settings) => `Codex phase timeout: ${formatSeconds(settings.phaseTimeoutSeconds ?? 1800)}` },
  { id: "strictReports", type: "toggle", label: (settings) => checkbox(Boolean(settings.strictReports), "Strict report quality gates") },
  { id: "json", type: "toggle", label: (settings) => checkbox(Boolean(settings.json), "JSON metadata and Codex events") },
  { id: "keepLogs", type: "toggle", label: (settings) => checkbox(Boolean(settings.keepLogs), "Keep technical logs") },
  { id: "progress", type: "toggle", label: (settings) => checkbox(settings.progress !== false, "Progress output") },
  { id: "ci", type: "toggle", label: (settings) => checkbox(Boolean(settings.ci), "CI mode") },
  { id: "failOnCritical", type: "toggle", label: (settings) => checkbox(Boolean(settings.failOnCritical), "Fail on critical findings") },
  { id: "save", type: "command", label: () => "Save and exit" },
  { id: "exit", type: "command", label: () => "Exit without saving" }
];
