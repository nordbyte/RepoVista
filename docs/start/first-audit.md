# First audit

The default command is optimized for a quality-oriented first run:

```sh
repovista audit
```

Fresh installs use Codex CLI, `reasoning=xhigh`, read-only sandbox intent, local checks, strict report gates, report repair, incremental cache, `parallel=auto`, and `sarif,html,jsonl` exports.

## What happens

1. RepoVista loads saved settings and applies CLI overrides.
2. It collects local evidence and optional check output.
3. It builds or refreshes scan metadata and the project map when needed.
4. It runs selected provider phases.
5. It validates report quality and evidence.
6. It repairs weak reports when `--repair-reports` is enabled.
7. It writes Markdown, structured JSON, exports, findings, and run metadata.

## Progress output

Interactive terminals show a live progress TUI with the current step, elapsed counters, provider phase status, and cancellation support. Press `q` or `Ctrl+C` to cancel.

Disable it with:

```sh
repovista audit --no-progress
```

CI mode disables interactive output automatically:

```sh
repovista audit --ci
```

## Next steps

```sh
repovista reports
repovista findings
repovista compare .repovista/old-run .repovista/new-run
```
