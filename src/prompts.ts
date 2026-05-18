export interface PromptContext {
  language: string;
  projectRoot: string;
  reportFolderName: string;
  inventoryMarkdown: string;
  previousReports: Record<string, string>;
}

export interface PhaseDefinition {
  id: string;
  title: string;
  reportFile: string;
  buildPrompt(context: PromptContext): string;
}

const CONTEXT_LIMIT = 18000;

export const ANALYSIS_PHASES: PhaseDefinition[] = [
  {
    id: "architecture",
    title: "Architektur-Analyse",
    reportFile: "01-architecture-report.md",
    buildPrompt: buildArchitecturePrompt
  },
  {
    id: "code-quality",
    title: "Codequalitäts-Analyse",
    reportFile: "02-code-quality-report.md",
    buildPrompt: buildCodeQualityPrompt
  },
  {
    id: "risk-and-bug",
    title: "Risiko-, Bug- und Security-Analyse",
    reportFile: "03-risk-and-bug-report.md",
    buildPrompt: buildRiskPrompt
  },
  {
    id: "feature-roadmap",
    title: "Feature- und Verbesserungs-Roadmap",
    reportFile: "04-feature-roadmap.md",
    buildPrompt: buildRoadmapPrompt
  },
  {
    id: "summary",
    title: "Gesamtübersicht",
    reportFile: "index.md",
    buildPrompt: buildSummaryPrompt
  }
];

function baseInstructions(context: PromptContext, role: string): string {
  return `Du bist ${role}. Analysiere das Repository im aktuellen Arbeitsverzeichnis: ${context.projectRoot}.

Sicherheits- und Arbeitsregeln:
- Arbeite strikt read-only. Verändere keine Dateien im Zielprojekt.
- Ignoriere den RepoVista-Reportordner \`${context.reportFolderName}\` und alte RepoVista-Reports vollständig als Projektcode.
- Führe keine destruktiven Befehle aus.
- Aktiviere keine unnötigen Netzwerkzugriffe.
- Nenne konkrete Pfade, Dateien, Module oder Konfigurationen, wenn möglich.
- Markiere Unsicherheiten klar als Hypothese oder offene Frage.
- Erfinde keine Fakten. Wenn etwas nicht belegbar ist, sage das.
- Priorisiere Findings und Empfehlungen nachvollziehbar.
- Schreibe den finalen Report in ${context.language}.
- Liefere ausschließlich den Markdown-Report als finale Antwort.

Lokales Projektinventar von RepoVista:

${clip(context.inventoryMarkdown)}
`;
}

function buildArchitecturePrompt(context: PromptContext): string {
  return `${baseInstructions(context, "Staff Software Architect")}

Aufgabe: Erstelle einen ausführlichen Architektur-Report.

Untersuche:
- Zweck und vermutete Hauptfunktion der Anwendung.
- Tech-Stack.
- zentrale Module, Komponenten, Services und APIs.
- Datenflüsse und Kontrollflüsse.
- Konfigurationsstruktur.
- Build-, Test- und Deployment-Struktur.
- Architektur-Muster.
- Kopplung, Kohäsion und Verantwortlichkeiten.
- besonders wichtige Dateien.
- Einstiegspunkte für neue Entwickler.

Der Report muss diese Abschnitte enthalten:
1. Executive Summary
2. Projektzweck
3. Tech-Stack
4. Modul- und Komponentenübersicht
5. Datenfluss und Kontrollfluss
6. Wichtige Dateien und ihre Rolle
7. Externe Abhängigkeiten und Integrationen
8. Architektur-Stärken
9. Architektur-Schwächen
10. Risiken für Wartbarkeit und Skalierung
11. Empfehlungen
12. Offene Fragen und Unsicherheiten
`;
}

function buildCodeQualityPrompt(context: PromptContext): string {
  return `${baseInstructions(context, "Senior Code Reviewer")}

Vorherige Architektur-Erkenntnisse:

${renderPrevious(context, ["01-architecture-report.md"])}

Aufgabe: Bewerte Codequalität, Stärken, Schwächen und Wartbarkeit aus Senior-Review-Perspektive.

Untersuche:
- Lesbarkeit, Struktur und Naming.
- Fehlerbehandlung und Testbarkeit.
- Modularität, Duplikate und unnötige Komplexität.
- Dependency-Nutzung, API-Design und Typisierung.
- Konfigurationsqualität und Wartbarkeit.

Der Report muss diese Abschnitte enthalten:
1. Executive Summary
2. Größte Stärken
3. Größte Schwächen
4. Code-Smells
5. Wartbarkeitsprobleme
6. Testabdeckung und Teststrategie
7. Technische Schulden
8. Priorisierte Empfehlungen
9. Quick Wins
10. Mittelfristige Refactorings
11. Größere Architekturmaßnahmen

Für relevante Schwächen nenne Datei oder Pfad, Problem, Auswirkung, Empfehlung und Priorität.
`;
}

function buildRiskPrompt(context: PromptContext): string {
  return `${baseInstructions(context, "defensiver Application-Security- und Bug-Audit-Reviewer")}

Vorherige Erkenntnisse:

${renderPrevious(context, ["01-architecture-report.md", "02-code-quality-report.md"])}

Aufgabe: Finde potenzielle Bugs, Sicherheitsrisiken und robuste Fehlerquellen. Handle defensiv; keine Exploit-Anleitungen gegen reale externe Ziele.

Untersuche:
- Input-Validation, Authentifizierung und Autorisierung.
- Secrets und Konfiguration.
- unsichere Datei- und Pfadverarbeitung.
- Injection-Risiken.
- XSS, CSRF, SSRF und ähnliche Risiken, falls relevant.
- unsichere Dependency-Nutzung.
- Race Conditions, fehlerhafte Async-Logik und Error-Handling-Pfade.
- Datenverlust-Risiken.
- Logging sensibler Daten.
- fehlende Tests für kritische Pfade.
- falsche Annahmen in Businesslogik.

Der Report muss diese Abschnitte enthalten:
1. Executive Summary
2. Kritische Befunde
3. Hohe Befunde
4. Mittlere Befunde
5. Niedrige Befunde
6. Potenzielle Bugs
7. Sicherheitsrisiken
8. Fehlende Tests
9. Empfohlene nächste Schritte

Für jeden Befund nenne Titel, Schweregrad, Kategorie, Datei oder Pfad, Evidenz aus dem Code, Problembegründung, konkreten Fix-Vorschlag und geschätzten Aufwand. Markiere unsichere Befunde ausdrücklich als Hypothese.
`;
}

function buildRoadmapPrompt(context: PromptContext): string {
  return `${baseInstructions(context, "product-minded Senior Engineer")}

Vorherige Erkenntnisse:

${renderPrevious(context, [
    "01-architecture-report.md",
    "02-code-quality-report.md",
    "03-risk-and-bug-report.md"
  ])}

Aufgabe: Leite aus Code, Architektur und bisherigen Reports eine konkrete Feature- und Verbesserungs-Roadmap ab.

Untersuche:
- Welche bestehenden Funktionen sinnvoll verbessert werden können.
- Welche Features wahrscheinlich fehlen.
- Welche Verbesserungen den größten Nutzen hätten.
- Welche Features zur vorhandenen Architektur passen.
- Welche Features zuerst Refactoring benötigen.
- Welche technischen Verbesserungen Stabilität, Sicherheit oder Developer Experience erhöhen.

Der Report muss diese Abschnitte enthalten:
1. Executive Summary
2. Sinnvolle Verbesserungen bestehender Funktionen
3. Sinnvolle neue Features
4. Fehlende technische Grundlagen
5. Developer-Experience-Verbesserungen
6. Security- und Reliability-Verbesserungen
7. Priorisierte Roadmap

Für jeden Vorschlag nenne Titel, Beschreibung, Begründung aus Code oder Architektur, Nutzen, Aufwand, Risiko, betroffene Dateien oder Module, mögliche Implementierungsschritte und Priorität. Vermeide generische Vorschläge.
`;
}

function buildSummaryPrompt(context: PromptContext): string {
  return `${baseInstructions(context, "technischer Redakteur und Tech-Lead")}

Detailreports:

${renderPrevious(context, [
    "01-architecture-report.md",
    "02-code-quality-report.md",
    "03-risk-and-bug-report.md",
    "04-feature-roadmap.md"
  ])}

Aufgabe: Erstelle die finale Gesamtübersicht als Einstiegspunkt \`index.md\`.

Der Report muss diese Abschnitte enthalten:
1. Kurzfazit
2. Was das Projekt macht
3. Architektur in wenigen präzisen Absätzen
4. Top-Stärken
5. Top-Schwächen
6. Kritischste Risiken
7. Wahrscheinlichste Bugs
8. Beste Quick Wins
9. Wichtigste Feature-Chancen
10. Empfohlene Reihenfolge der nächsten Schritte
11. Verweise auf die Detailreports

Verlinke die Detailreports mit diesen relativen Markdown-Links:
- [Projektinventar](00-inventory.md)
- [Architektur-Report](01-architecture-report.md)
- [Codequalitäts-Report](02-code-quality-report.md)
- [Risiko-, Bug- und Security-Report](03-risk-and-bug-report.md)
- [Feature-Roadmap](04-feature-roadmap.md)
`;
}

function renderPrevious(context: PromptContext, reportFiles: string[]): string {
  const sections = reportFiles.map((fileName) => {
    const content = context.previousReports[fileName];
    if (!content) {
      return `## ${fileName}\n\nNoch nicht verfügbar oder fehlgeschlagen.`;
    }
    return `## ${fileName}\n\n${clip(content)}`;
  });
  return sections.join("\n\n");
}

function clip(content: string): string {
  if (content.length <= CONTEXT_LIMIT) {
    return content;
  }
  return `${content.slice(0, CONTEXT_LIMIT)}\n\n... Kontext von RepoVista gekürzt ...`;
}
