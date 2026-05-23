import { defineConfig } from "vitepress";

const repo = "https://github.com/nordbyte/RepoVista";

export default defineConfig({
  title: "RepoVista",
  description: "Structured, read-only AI repository audits from local provider CLIs.",
  lang: "en-US",
  cleanUrls: false,
  lastUpdated: true,
  sitemap: {
    hostname: "https://repovista.com"
  },
  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" }],
    ["link", { rel: "alternate icon", type: "image/png", sizes: "256x256", href: "/repovista-logo.png" }],
    ["link", { rel: "apple-touch-icon", href: "/repovista-logo.png" }],
    ["meta", { name: "theme-color", content: "#16724a" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:title", content: "RepoVista documentation" }],
    ["meta", { property: "og:description", content: "Structured AI repository audit documentation and CLI reference." }],
    ["meta", { property: "og:url", content: "https://repovista.com/" }]
  ],
  themeConfig: {
    logo: "/repovista-logo.png",
    siteTitle: "RepoVista docs",
    nav: [
      { text: "Home", link: "/" },
      { text: "GitHub", link: repo },
      { text: "npm", link: "https://www.npmjs.com/package/repovista" }
    ],
    search: {
      provider: "local"
    },
    outline: {
      level: [2, 3],
      label: "On this page"
    },
    editLink: {
      pattern: `${repo}/edit/main/docs/:path`,
      text: "Edit page"
    },
    socialLinks: [
      { icon: "github", link: repo }
    ],
    docFooter: {
      prev: "Previous",
      next: "Next"
    },
    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright (c) Nordbyte"
    },
    sidebar: [
      {
        text: "Start",
        items: [
          { text: "Overview", link: "/" },
          { text: "Install RepoVista", link: "/start/install" },
          { text: "Quickstart", link: "/start/quickstart" },
          { text: "Core concepts", link: "/start/core-concepts" },
          { text: "First audit", link: "/start/first-audit" },
          { text: "Troubleshooting", link: "/start/troubleshooting" }
        ]
      },
      {
        text: "Workflows",
        items: [
          { text: "Configuration", link: "/guides/configuration" },
          { text: "Providers", link: "/guides/providers" },
          { text: "GitHub source audits", link: "/guides/github-source" },
          { text: "Workspaces", link: "/guides/workspaces" },
          { text: "Reports and state", link: "/guides/reports" },
          { text: "Findings", link: "/guides/findings" },
          { text: "Publishing", link: "/guides/publishing" },
          { text: "Fixes and patches", link: "/guides/fixes" },
          { text: "CI/CD", link: "/guides/ci" }
        ]
      },
      {
        text: "Reference",
        items: [
          { text: "CLI command reference", link: "/commands/" },
          { text: "CLI options", link: "/reference/options" },
          { text: "Settings keys", link: "/reference/settings" },
          { text: "Audit profiles", link: "/reference/profiles" },
          { text: "Output files", link: "/reference/output-files" },
          { text: "Exit codes", link: "/reference/exit-codes" }
        ]
      },
      {
        text: "Command docs",
        collapsed: true,
        items: [
          { text: "audit", link: "/commands/audit" },
          { text: "init", link: "/commands/init" },
          { text: "plan", link: "/commands/plan" },
          { text: "doctor", link: "/commands/doctor" },
          { text: "providers", link: "/commands/providers" },
          { text: "profiles", link: "/commands/profiles" },
          { text: "ci init", link: "/commands/ci-init" },
          { text: "compare", link: "/commands/compare" },
          { text: "review", link: "/commands/review" },
          { text: "repair-run", link: "/commands/repair-run" },
          { text: "pr-comment", link: "/commands/pr-comment" },
          { text: "baseline", link: "/commands/baseline" },
          { text: "suppress", link: "/commands/suppress" },
          { text: "clean-locks", link: "/commands/clean-locks" },
          { text: "findings", link: "/commands/findings" },
          { text: "findings-ui", link: "/commands/findings-ui" },
          { text: "reports", link: "/commands/reports" },
          { text: "next", link: "/commands/next" },
          { text: "show", link: "/commands/show" },
          { text: "triage", link: "/commands/triage" },
          { text: "revalidate", link: "/commands/revalidate" },
          { text: "issue", link: "/commands/issue" },
          { text: "github-status", link: "/commands/github-status" },
          { text: "publish", link: "/commands/publish" },
          { text: "fix", link: "/commands/fix" },
          { text: "patches", link: "/commands/patches" },
          { text: "rollback", link: "/commands/rollback" },
          { text: "open-pr", link: "/commands/open-pr" },
          { text: "settings", link: "/commands/settings" },
          { text: "help and version", link: "/commands/help-version" }
        ]
      },
      {
        text: "Internals",
        items: [
          { text: "Architecture", link: "/internals/architecture" },
          { text: "Security model", link: "/internals/security" },
          { text: "API reference", link: "/internals/api" },
          { text: "Development", link: "/internals/development" }
        ]
      }
    ]
  }
});
