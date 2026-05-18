import { RepoVistaError } from "./errors.js";
import { loadSettings, saveSettings } from "./settings-config.js";
import { normalizeSettingKey, parseSettingValue } from "./settings-schema.js";
import type { AuditOptions } from "./types.js";

export async function runSettingsGetCommand(options: AuditOptions): Promise<string> {
  const settings = await loadSettings();
  if (!options.settingsKey) {
    return `${JSON.stringify(settings, null, 2)}\n`;
  }
  const key = normalizeSettingKey(options.settingsKey);
  return `${JSON.stringify(settings[key] ?? null, null, 2)}\n`;
}

export async function runSettingsSetCommand(options: AuditOptions): Promise<string> {
  if (!options.settingsKey || options.settingsValue === undefined) {
    throw new RepoVistaError("Command settings set requires a key and value.");
  }
  const key = normalizeSettingKey(options.settingsKey);
  const settings = await loadSettings();
  settings[key] = parseSettingValue(key, options.settingsValue) as never;
  await saveSettings(settings);
  return `Saved RepoVista setting ${key}.\n`;
}

export async function runSettingsResetCommand(options: AuditOptions): Promise<string> {
  const settings = await loadSettings();
  if (!options.settingsKey) {
    await saveSettings({});
    return "Reset all RepoVista settings.\n";
  }
  const key = normalizeSettingKey(options.settingsKey);
  delete settings[key];
  await saveSettings(settings);
  return `Reset RepoVista setting ${key}.\n`;
}
