# RepoVista

RepoVista ist ein npm-installierbares CLI-Tool, das im aktuellen Projektverzeichnis einen strukturierten, read-only Codex-Audit orchestriert. Es sammelt zuerst ein kompaktes lokales Projektinventar, startet danach mehrere spezialisierte `codex exec`-Läufe und schreibt die Ergebnisse als Markdown-Reports nach `.repovista/<run-id>`.

RepoVista ist kein Ersatz für manuelle Reviews, Tests, SAST-Scanner, Dependency-Audits oder Security-Assessments. Es ist ein schneller Einstieg, um Architektur, Qualität, Risiken, Bugs und sinnvolle Verbesserungen eines Repositories besser zu verstehen.

## Voraussetzungen

- Node.js 20 oder neuer.
- Eine separat installierte und authentifizierte offizielle Codex CLI.
- Der Befehl `codex` muss im `PATH` verfügbar sein.
- Ausführungsrechte und Datenschutzfreigabe für das Repository, das analysiert werden soll.

RepoVista installiert Codex nicht per Postinstall-Skript und aktiviert keine Telemetrie.

## Installation

Lokal aus dem Repository:

```sh
npm install
npm run build
npm link
```

Nach einer Veröffentlichung:

```sh
npm install -g repovista
```

## Nutzung

Im Projektroot ausführen:

```sh
repovista
```

Der explizite Audit-Befehl ist gleichwertig:

```sh
repovista audit
```

Beispiele:

```sh
repovista audit --language English --model gpt-5.5
repovista audit --out reports/repovista --keep-logs
repovista audit --ci --json --fail-on-critical --no-progress
```

## Reportstruktur

Jeder Lauf erzeugt einen eigenen Timestamp-Ordner:

```text
.repovista/
  2026-05-18T14-57-32-123Z/
    00-inventory.md
    01-architecture-report.md
    02-code-quality-report.md
    03-risk-and-bug-report.md
    04-feature-roadmap.md
    index.md
    meta.json
    logs/
```

`index.md` ist der Einstiegspunkt. Die Detailreports enthalten Architektur, Codequalität, Risiken/Bugs/Security und Feature-Roadmap. `meta.json` enthält Laufoptionen, Phasenstatus und Preflight-Informationen. `logs/` wird nur bei `--keep-logs` oder `--json` angelegt.

## CLI-Optionen

| Option | Zweck |
|---|---|
| `--out <dir>` | Zielordner für Reports, Standard `.repovista` |
| `--model <name>` | Codex-Modell überschreiben |
| `--profile <name>` | Codex-Profil aus der Codex-Konfiguration verwenden |
| `--sandbox <mode>` | Codex-Sandbox, `read-only` oder `workspace-write`, Standard `read-only` |
| `--language <name>` | Sprache der Reports, Standard `Deutsch` |
| `--json` | Metadaten und Codex-JSONL-Events speichern |
| `--include <patterns>` | Zusätzliche Include-Patterns für Inventar/Kontext dokumentieren |
| `--ignore <patterns>` | Zusätzliche Ignore-Patterns für Inventar und Kontext |
| `--ci` | CI-freundlicher Modus ohne Fortschrittsausgabe |
| `--fail-on-critical` | In CI bei kritischen Findings Exit-Code `2` zurückgeben |
| `--no-progress` | Fortschrittsausgabe reduzieren |
| `--keep-logs` | Technische Codex-Logs speichern |
| `--version` | Version anzeigen |
| `--help` | Hilfe anzeigen |

## Sicherheitsmodell

RepoVista ist standardmäßig ein Audit-Tool und kein Auto-Fix-Tool.

- Codex wird standardmäßig mit `--sandbox read-only` gestartet.
- `danger-full-access` und Full-Access-Varianten werden im MVP abgelehnt.
- RepoVista selbst schreibt nur in den Reportordner.
- Alte `.repovista`-Reports, Dependencies, Build-Artefakte, Caches, Coverage, Medienassets und Archive werden vom Inventar ausgeschlossen.
- Sensible Werte in gelesenen Metadaten werden maskiert; `.env`-Inhalte werden nicht in Reports übernommen.
- Es gibt keine automatische Codex-Installation, keine destruktiven Befehle und keine Telemetrie.

Wichtig: Codex kann im Rahmen seiner Analyse auf das Repository zugreifen und Quellcode an den verwendeten Codex-Dienst übergeben. Verwende RepoVista nur in Repositories, für die du die nötigen Rechte und Datenschutzfreigaben hast.

## Codex-CLI-Abhängigkeit

RepoVista prüft vor dem Audit, ob `codex` verfügbar ist. Die Analysephasen werden über `codex exec` gestartet. Der Zielordner ist immer das aktuelle Arbeitsverzeichnis, in dem `repovista` ausgeführt wird.

RepoVista setzt für Codex:

- `--cd <aktuelles Projektverzeichnis>`
- `--config approval_policy="never"` für nicht-interaktive Läufe
- `--sandbox read-only` als Standard
- `--skip-git-repo-check`, damit auch bewusst nicht-git-basierte Projektordner analysierbar bleiben
- `--output-last-message <report.md>`, damit die finale Antwort sauber vom technischen Stream getrennt ist

## CI-Hinweise

Für CI/CD:

```sh
repovista audit --ci --json --fail-on-critical
```

Exit-Codes:

- `0`: Audit abgeschlossen, keine kritische CI-Sperre.
- `1`: Mindestens eine Analysephase ist fehlgeschlagen oder ein fataler Fehler trat auf.
- `2`: `--ci --fail-on-critical` wurde gesetzt und der Risiko-Report enthält kritische Findings.

Die Reports können als CI-Artefakte aus dem gewählten `--out`-Ordner gespeichert werden.

## Typische Workflows

- Fremdes Repository verstehen: `repovista`, danach `.repovista/<run-id>/index.md` lesen.
- Technische Logs für Fehlersuche behalten: `repovista audit --keep-logs`.
- Englische Reports erzeugen: `repovista audit --language English`.
- Bestimmte generierte Ordner zusätzlich ignorieren: `repovista audit --ignore "fixtures/generated/**"`.

## Troubleshooting

`Codex CLI wurde nicht gefunden`
: Installiere und authentifiziere Codex separat. Prüfe danach `codex --version`.

`Codex CLI scheint nicht authentifiziert zu sein`
: Melde die Codex CLI an und starte den Audit erneut.

`Das aktuelle Verzeichnis sieht nicht wie ein Codeprojekt aus`
: Führe RepoVista im Projektroot aus. Erkennbare Marker sind unter anderem `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `README.md`, `src/`, `lib/` oder `app/`.

`Sandbox-Modus abgelehnt`
: Verwende `read-only` oder, nur bei bewusster Entscheidung, `workspace-write`. RepoVista ist nicht für automatische Codeänderungen im MVP gedacht.

Sehr große Repositories
: RepoVista kürzt das Inventar und markiert ausgelassene Einträge. Codex kann das Repository weiterhin selbst lesen, erhält aber nur kompakten Orientierungskontext.

## Entwicklung

```sh
npm install
npm run typecheck
npm test
```

Die Unit-Tests rufen Codex nicht real auf. Der Codex-Runner wird mit gemockten Prozessen getestet.
