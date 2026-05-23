import { readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";
import { CLI_COMMANDS, CLI_OPTIONS, SETTING_DEFINITIONS } from "../dist/index.js";

test("documentation reference covers current commands options and settings", async () => {
  const [optionsMarkdown, settingsMarkdown, commandIndex, commandFiles] = await Promise.all([
    readFile("docs/reference/options.md", "utf8"),
    readFile("docs/reference/settings.md", "utf8"),
    readFile("docs/commands/index.md", "utf8"),
    readdir("docs/commands")
  ]);

  const documentedOptions = documentedCliOptions(optionsMarkdown);
  const currentOptions = CLI_OPTIONS.map((option) => option.name);
  assert.deepEqual(missingFrom(currentOptions, documentedOptions), [], "docs/reference/options.md is missing current CLI options");
  assert.deepEqual(missingFrom([...documentedOptions], new Set(currentOptions)), [], "docs/reference/options.md documents unknown CLI options");

  const documentedSettings = documentedSettingKeys(settingsMarkdown);
  const currentSettings = SETTING_DEFINITIONS.map((setting) => setting.key);
  assert.deepEqual(missingFrom(currentSettings, documentedSettings), [], "docs/reference/settings.md is missing current settings");
  assert.deepEqual(missingFrom([...documentedSettings], new Set(currentSettings)), [], "docs/reference/settings.md documents unknown settings");

  const docsFiles = new Set(commandFiles.filter((file) => file.endsWith(".md")).map((file) => file.replace(/\.md$/, "")));
  for (const command of uniqueCommands()) {
    const slug = commandSlug(command.name);
    assert.equal(docsFiles.has(slug), true, `missing docs/commands/${slug}.md`);
    assert.match(commandIndex, new RegExp(`\\(${escapeRegExp(slug)}\\.md\\)`), `docs/commands/index.md does not link ${slug}.md`);
  }
});

function documentedCliOptions(markdown) {
  return new Set([...markdown.matchAll(/`--([a-z0-9-]+)(?:\s+<[^`]+>)?`/g)].map((match) => match[1]));
}

function documentedSettingKeys(markdown) {
  const keys = [];
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.startsWith("| `")) {
      continue;
    }
    const firstCell = line.split("|")[1] ?? "";
    keys.push(...[...firstCell.matchAll(/`([^`]+)`/g)].map((match) => match[1]));
  }
  return new Set(keys);
}

function uniqueCommands() {
  return [...new Map(CLI_COMMANDS.map((command) => [command.name, command])).values()];
}

function commandSlug(name) {
  return name === "ci init" ? "ci-init" : name;
}

function missingFrom(values, documented) {
  return values.filter((value) => !documented.has(value));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
