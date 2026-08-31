# SARKSH Portal V9 — Customer-First Account Experience

- Customer notification bell added across signed-in customer pages.
- Agreement page no longer exposes SHA-256 or internal/admin wording.
- Customer-facing agreement displays company, title, version, and optional effective date.
- When no agreement is published, customers see a neutral up-to-date state.
- Existing customers receive an agreement notification until the current published version is accepted.
- New customers continue to sign the active agreement during registration.
- Admin agreement publisher now controls company, title, version, effective date, text, and active state.
- No external API architecture from V8 is preserved.

Migration: run `migrateExistingDatabaseToV9()` in the existing Apps Script project, then update the existing Web App deployment version and keep the same /exec URL.
