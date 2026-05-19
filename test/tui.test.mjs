import test from "node:test";
import assert from "node:assert/strict";
import { renderTuiTextFrame } from "../dist/index.js";

test("TUI text frame styles markdown headings and bold spans in color mode", () => {
  const frame = renderTuiTextFrame({
    title: "RepoVista Reports",
    help: "Help",
    sectionTitle: "Section",
    lines: [
      "# Executive Summary",
      "This is **important** context.",
      "```",
      "## Code block heading",
      "**literal markdown**",
      "```"
    ],
    scroll: 0,
    columns: 100,
    rows: 14,
    color: true
  });
  const plain = frame.replace(/\x1b\[[0-9;]*m/g, "");

  assert.match(frame, /\x1b\[1m\x1b\[36m# Executive Summary\x1b\[0m/);
  assert.match(frame, /This is \x1b\[1m\x1b\[97mimportant\x1b\[0m context\./);
  assert.match(plain, /This is important context\./);
  assert.doesNotMatch(plain, /\*\*important\*\*/);
  assert.match(plain, /## Code block heading/);
  assert.match(plain, /\*\*literal markdown\*\*/);
});

test("TUI text frame leaves markdown markers untouched without color", () => {
  const frame = renderTuiTextFrame({
    title: "RepoVista Reports",
    help: "Help",
    sectionTitle: "Section",
    lines: [
      "## Details",
      "Keep **plain** markers."
    ],
    scroll: 0,
    columns: 80,
    rows: 10,
    color: false
  });

  assert.match(frame, /## Details/);
  assert.match(frame, /Keep \*\*plain\*\* markers\./);
  assert.doesNotMatch(frame, /\x1b\[[0-9;]*m/);
});
