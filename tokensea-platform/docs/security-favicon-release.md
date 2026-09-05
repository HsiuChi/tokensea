# Security dependencies and favicon — 2026-09-05

The login HTML referenced `/favicon.png`, but the old image was located at
`web/publicfavicon.png`, outside Vite's public directory. Icon links now point
to the existing TokenSea brand marks in `web/public/shared`, with a dark-theme
variant and an Apple touch icon. Query versioning avoids the previous cached URL.

Security changes:

- SheetJS 0.18.5 -> official 0.20.3 CDN distribution, pinned with lockfile integrity.
  Official installation: https://docs.sheetjs.com/docs/getting-started/installation/frameworks/
  Advisory: https://cdn.sheetjs.com/advisories/CVE-2024-22363
- Override minimist to 1.2.8 for the chart dependency tree.
- Upgrade Fastify, static plugin, Nodemailer and affected transitive packages to
  patched releases. Retain Prisma 6.19.3 and its schema; override deepmerge-ts to
  8.0.0 and tsx's esbuild to 0.28.1. Reassess these overrides on future upgrades.
- Adapt Nodemailer transport typing to its new bundled type definitions.
- Docker builds use `npm ci` so dependency resolution follows committed lockfiles.

Validation: both npm audits report zero known vulnerabilities at verification
time; 47 unit tests, backend/frontend type checks, production frontend build,
isolated-database migrations and both billing integration suites pass. Added
regressions cover Chinese XLSX/XLS/ODS/CSV extraction, prototype pollution,
favicon assets, protected routes/path traversal, and MIME email generation
without sending mail. No database schema or production pricing changes.

The existing large frontend bundle warning is a performance follow-up, not a
dependency security advisory. A clean audit does not prove absence of unknown
vulnerabilities.
