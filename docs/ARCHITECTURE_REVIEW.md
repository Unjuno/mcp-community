# Architecture, UX and security review — 2026-11-06

## Decision

**Retain the MVP modular monolith.** Do not switch to Astro, PHP, multi-service orchestration, a separate message queue, or a full-blown state-machine library. The core already shares service authorization between Hono SSR and the official MCP v2 transport; the main weaknesses were _implicit state transitions and inconsistent UI projections_, not missing infrastructure.

## Review method

1. Inspect repository and supplied runnable source, migrations, extension contracts, SSR Web routes, official SDK adapter and security notes.
2. Run the existing **47 tests** with Node.js 24.22.2 and inspect failure cases across domain boundaries.
3. Add tests that must fail for each behavioral defect; fix the smallest service/DB/UI boundary and rerun.
4. Review the exact source diff, migration append-only policy, and upgrade compatibility tests.
5. Record remaining risks separately from claims of successful automated verification.

## Reviewed areas

| Area                 | Finding                                                                             | Priority | Work performed                                                          |
| -------------------- | ----------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------- |
| Knowledge            | A pending proposal silently becomes unapprovable when another revision is published | High     | Explicit `conflicted` projection in core, Web queue/detail and MCP list |
| Knowledge            | A proposal could initially target an already-stale revision                         | High     | Reject at submission with `REVISION_CONFLICT`                           |
| Knowledge DB         | Terminal proposal records could be rewritten by a mistaken future code path         | High     | Additive migration 3 terminal/decision guards                           |
| Credentials          | Disabled actor/owner could be re-enabled, resurrecting tokens                       | High     | Revocation is terminal, with owner-agent cascade                        |
| Credentials          | Password-reset incident could leave owned agent tokens valid                        | High     | Revoke dependent credentials on password reset                          |
| Auditing             | Repeated revocation/moderation caused duplicate audit entries                       | Medium   | Idempotent no-op for unchanged states                                   |
| Forum                | Opening post could disappear while a visible thread remained                        | Medium   | Reject and guide moderation to the thread                               |
| Events               | Approval emitted only `knowledge.updated`, not proposal resolution                  | Medium   | Both events now inserted in one transaction                             |
| Knowledge provenance | Blank approval note overwrote contributor evidence                                  | Medium   | Preserve contributor note when review note blank                        |
| UI                   | Active section and keyboard skip link absent; status labels unclear                 | Medium   | Add active navigation, skip link and semantic status styling            |
| Maintainability      | CSS was one compressed line                                                         | Low      | Readable CSS variables, responsive rules and reduced-motion support     |

## Dependency and trust boundaries

- **External clients:** Web (cookie + CSRF + Origin) and MCP (Bearer + scope) must never bypass `Runtime.require` and per-application service checks.
- **Persistence:** SQLite transactions protect publication, reviewer decision, audit, and outbox from partial success. Migration 3 strengthens terminal states without editing migration 1 or 2.
- **Extensions:** local administrator-reviewed Node packages remain fully trusted in-process. The API cannot sandbox arbitrary imports. The `ExtensionExecutionContext` surface is capability-limited, but arbitrary Node imports are not.
- **Event delivery:** `outbox_events` is append-only persistence, not an executed worker. Do not present it as real-time propagation.
- **MCP:** follow the official 2026-07-28 protocol; transport is stateless, application state remains explicit via IDs. OAuth is not implemented.

## Visual/interaction design conclusions

The user deliberately requested **forum simplicity**, not a theme editor. Hono JSX SSR remains appropriate. Improvements focus on legible information hierarchy, consistent contrast, keyboard focus, a skip link, active-page semantics, human/agent attribution, and reviewing stale proposals without offering invalid actions. No client-side SPA, new build chain, cookies beyond the existing session, or additional JS dependencies were introduced. Automated DOM/HTTP tests are not a substitute for a physical screen-reader or browser usability study.

Colors are defined as CSS custom properties, not user-configurable themes. Sample foreground/background contrasts were calculated using sRGB relative luminance: body text on white 14.95:1, muted text 6.38:1, link text 8.58:1, conflicted status 7.65:1. These are static calculations for the tested tokens, **not a complete WCAG conformance audit**.

## Unresolved risks (deliberately outside this change)

- Mutating MCP tools lack idempotency keys. Clients must inspect server state before retrying ambiguous failed requests.
- No OAuth/OIDC flow; manually provisioned bearer headers are not universal client interoperability.
- No trusted extension sandbox or signed registry; a malicious enabled extension has full Node process privileges.
- No operator policy for personal-data removal from immutable records; define redaction, access and retention before broad public deployment.
- A single SQLite writer/Node process is the verified target; no benchmark or HA promise.
- Visual browser usability, third-party developer success rate, and independent security audit remain unverified.
- Legacy threads with an already-hidden opening post are not silently edited; operators can hide the corresponding thread.

## Next release gates

- Fresh CI on the review branch: `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run smoke`, dependency audit and Docker Compose build/start.
- Run a predecessor-DB upgrade plus new `proposal_decision_state_guard` trigger test.
- Perform third-party developer trial on extension API before claiming ease of customization.
- Human review of account-reset credential revocation semantics before a stable release.

See [State machines](STATE_MACHINES.md) for precise transition tables, guards, and test mappings.
