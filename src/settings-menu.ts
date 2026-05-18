import readline from "node:readline";
import type { ReadStream, WriteStream } from "node:tty";
import { RepoVistaError } from "./errors.js";
import { loadCodexModels, reasoningOptionsForModel, type CodexModelInfo } from "./codex-models.js";
import { getSettingsPath, loadSettings, saveSettings, type RepoVistaSettings } from "./settings-config.js";
import type { SandboxMode } from "./types.js";

type MenuScreen = "main" | "model" | "reasoning" | "sandbox" | "language";

interface MenuState {
  screen: MenuScreen;
  cursor: number;
  settings: RepoVistaSettings;
  models: CodexModelInfo[];
  done: boolean;
  saved: boolean;
  settingsPath: string;
}

const LANGUAGE_OPTIONS = ["English", "German", "Spanish", "French", "Italian", "Portuguese"];
const SANDBOX_OPTIONS: SandboxMode[] = ["read-only", "workspace-write"];

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
    `Fast mode: ${settings.fastMode ? "on" : "off"}`,
    `Sandbox: ${settings.sandbox ?? "read-only"}`,
    `Language: ${settings.language ?? "English"}`,
    `Output directory: ${settings.outDir ?? ".repovista"}`,
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
      state.screen = item.id;
      state.cursor = 0;
      break;
    case "fastMode":
    case "json":
    case "keepLogs":
    case "progress":
    case "ci":
    case "failOnCritical":
      toggleBoolean(state, item.id);
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
  }
}

function toggleBoolean(state: MenuState, key: keyof RepoVistaSettings): void {
  const current = state.settings[key];
  state.settings[key] = !current as never;
}

function render(state: MenuState, output: WriteStream): void {
  output.write("\x1b[2J\x1b[H");
  output.write("RepoVista Settings\n\n");
  output.write("Use arrow keys to move, Space to select or clear, Enter to return/save.\n\n");

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
    case "main":
      return MAIN_ITEMS.map((item) => item.label(state.settings));
  }
}

function checkbox(selected: boolean, label: string): string {
  return `[${selected ? "x" : " "}] ${label}`;
}

const MAIN_ITEMS = [
  { id: "model", type: "submenu", label: (settings: RepoVistaSettings) => `Model: ${settings.model ?? "Codex default"}` },
  { id: "reasoning", type: "submenu", label: (settings: RepoVistaSettings) => `Reasoning: ${settings.reasoning ?? "model default"}` },
  { id: "fastMode", type: "toggle", label: (settings: RepoVistaSettings) => checkbox(Boolean(settings.fastMode), "Fast mode") },
  { id: "sandbox", type: "submenu", label: (settings: RepoVistaSettings) => `Sandbox: ${settings.sandbox ?? "read-only"}` },
  { id: "language", type: "submenu", label: (settings: RepoVistaSettings) => `Language: ${settings.language ?? "English"}` },
  { id: "json", type: "toggle", label: (settings: RepoVistaSettings) => checkbox(Boolean(settings.json), "JSON metadata and Codex events") },
  { id: "keepLogs", type: "toggle", label: (settings: RepoVistaSettings) => checkbox(Boolean(settings.keepLogs), "Keep technical logs") },
  { id: "progress", type: "toggle", label: (settings: RepoVistaSettings) => checkbox(settings.progress !== false, "Progress output") },
  { id: "ci", type: "toggle", label: (settings: RepoVistaSettings) => checkbox(Boolean(settings.ci), "CI mode") },
  { id: "failOnCritical", type: "toggle", label: (settings: RepoVistaSettings) => checkbox(Boolean(settings.failOnCritical), "Fail on critical findings") },
  { id: "save", type: "command", label: () => "Save and exit" },
  { id: "exit", type: "command", label: () => "Exit without saving" }
] as const;
