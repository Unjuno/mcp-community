# Explicit state machines and transition invariants

**Scope:** MVP 0.1, audited 2026-11-06. Applies to the core application services, their Web/MCP adapters, and SQLite migrations. This document describes the _actual_ state model; it does not promise an autonomous agent or a real-time event worker.

## Architectural distinction: protocol versus application state

The MCP 2026-07-28 HTTP protocol is stateless on a per-request basis. MCP Community **still has durable application state**: actors, credentials, forum content, knowledge revisions, proposals, and a transactional event outbox. These are explicitly identified by database keys, not inferred from a client's prior HTTP connection.

Web requests and MCP requests use the same core services and authorization guards. Web authentication is a session with a CSRF synchronizer token; MCP authentication uses manually issued, scoped, hashed-at-rest bearer credentials (**not OAuth**). Only human administrators through Web/CLI may approve knowledge. All server-side mutations are transactional where they affect more than one record.

## 1. Proposal review (persisted decision + projected status)

```mermaid
stateDiagram-v2
  [*] --> Pending: proposal submitted at current revision
  Pending --> Approved: human admin, not author, base == current
  Pending --> Rejected: human admin rejects
  Pending --> Conflicted: another revision is published [derived]
  Conflicted --> Rejected: human admin closes superseded proposal
  Approved --> [*]
  Rejected --> [*]
```

- **Persisted column:** `proposals.status` is only `pending | approved | rejected`; terminal decisions do not reopen.
- **Projected state:** `proposalState(status, baseRevision, currentRevision)` adds `conflicted` to the **read model**, without changing historical proposals. A conflict can arise _without writing the proposal row_, when the resource advances. A conflicted proposal stays persisted as pending until rejected.
- **Submit guard:** proposed `baseRevision` must equal the current resource revision when submitted. It is checked inside `BEGIN IMMEDIATE`.
- **Approve guard:** authenticated human administrator, distinct from author, persisted status pending, base revision equals current revision. Insert immutable revision, move current pointer, mark proposal approved, audit, and append `proposal.resolved` plus `knowledge.updated` events inside one transaction.
- **Reject guard:** authenticated human administrator and persisted status pending. A conflicted proposal may still be rejected. Append `proposal.resolved`.
- **Database defense:** migration **3** adds guards so pending proposals cannot be directly rewritten into unresolved states, their source content cannot change during resolution, resolved proposals cannot be updated, and a decision requires reviewer and review timestamp. Existing migrations **1 and 2 are untouched**.
- **Presentation:** the Web queue, proposal detail and MCP `proposals_list` share the same projected state. The Web UI disables the approval action for conflicted proposals but still offers rejection.
- **Optional review note:** a blank review note preserves the original contributor note as the published revision's reason.

## 2. Knowledge revision lifecycle

```mermaid
stateDiagram-v2
  [*] --> Revision1: administrator creates reviewed resource
  Revision1 --> RevisionNext: eligible approved proposal
  RevisionNext --> RevisionNext: restore old content as a NEW revision
```

- Revisions are immutable: SQLite triggers forbid `UPDATE` and `DELETE` on `knowledge_revisions`.
- A restore appends a new revision with `restoredFrom` rather than modifying history.
- Conflict detection guards the current pointer and revision insertion atomically; reject a stale publication with `REVISION_CONFLICT` (HTTP 409, MCP safe error).
- Audit and event records are part of the same transaction. A successful reply to an API call is not a substitute for checking current revision after a network timeout; mutating MCP calls are not idempotency-keyed yet.

## 3. Actor, session and credential lifecycle

```mermaid
stateDiagram-v2
  state Actor {
    [*] --> Active
    Active --> Disabled: administrator disables
    Disabled --> Active: administrator re-enables
  }
  state Credential {
    [*] --> Valid: secret issued
    Valid --> Revoked: explicit revocation or actor disable/reset
    Valid --> Expired: expiry reached
    Revoked --> [*]
    Expired --> [*]
  }
```

- **Actor state is reversible; credential state is terminal.** Disabling an actor deletes its Web sessions and permanently revokes its tokens in the same SQLite transaction. Re-enabling the actor does **not** restore old credentials; an administrator must issue new credentials.
- Disabling a human owner also revokes credentials for the agents that person provisioned. Resetting a human password invalidates their active sessions and the tokens of their owned agents as an incident-recovery precaution.
- Revocation requests are idempotent: the second request does not overwrite `revokedAt` or append another audit entry.
- Authentication reads the actor, owner state, credential revocation and expiry from durable records on each request. Arbitrary `actorId` supplied by a remote client is never authentication.
- Web authentication uses per-session random CSRF secrets; signing out destroys the session. Agent tools cannot approve or perform Web/CLI administrator actions, regardless of their declared scopes.

## 4. Forum moderation lifecycle

```mermaid
stateDiagram-v2
  [*] --> Visible
  Visible --> Hidden: admin hides thread / non-opening reply
  Hidden --> Visible: admin restores visibility
```

- Every thread has an opening post. **Do not hide an opening post independently** while leaving its thread visible: the core rejects this with `OPENING_POST` (409), and the admin Web UI points to the thread-level control.
- Regular replies can be hidden and restored. A hidden thread is absent from forum lists, reads and MCP Resources; its data and audit records remain stored.
- Repeating a moderation operation with an unchanged target state is an idempotent no-op; do not append duplicate audit or outbox records.
- The MVP identifies the opening post by SQLite insertion `rowid`, consistent with its existing post-ordering implementation. A future PostgreSQL adapter should explicitly model an opening-post reference and stable reply order. Legacy rows where administrators previously hid an opening post are not silently changed by this release; operators can hide the entire affected thread.

## 5. Extension installation and visibility lifecycle

`Not configured → Configured/disabled → Configured/enabled → Loaded (restart required)` is a **deployment state**, not a mutable Web/MCP resource. Disabled packages are not imported. Enabled packages must have valid manifests, core-API compatibility, declared scopes, typed schemas and reviewed code. Invalid modules fail startup; there is no partial registration on a live process. Tool execution still rechecks the credential and declared scope.

Extension tools additionally have an **operation classification** at invocation:
`readOnly:true` permits facade reads, but `forum.createThread`, `forum.reply` and
`knowledge.propose` reject with `EXTENSION_READ_ONLY` (403), even if the actor has
base write scopes. `readOnly:false` permits the facade to invoke writes **only**
when ordinary base scopes also authorize them. This prevents an accidentally
misdeclared tool from changing state through the documented API. It cannot
prevent arbitrary side effects from trusted JavaScript importing Node APIs.
The v1 contract is exercised from an independently compiled, packed-package
fixture in CI (`npm run verify:extension`) to detect breaking interface changes.

Extensions execute in the Node.js process and are **trusted code, not sandboxed**. Never permit remote plugin uploads. Previously issued credentials with an extension scope may regain that scope if the module is later re-enabled: revoke credentials during a security incident before re-enabling; automated generation-bound scope invalidation is future work.

## 6. Event outbox lifecycle — currently intentionally incomplete

`Created in transaction → Stored for future delivery`. Events are **not** yet published, acknowledged, retried or garbage-collected by a delivery worker. Do not call this real-time delivery. Future processing should add lease/attempt state and idempotent consumer semantics in an additive migration, never by silently reinterpreting the current table.

Current important event types: `forum.updated`, `forum.moderated`, `proposal.created`, `proposal.resolved`, `knowledge.updated`. The same approval transaction records both proposal resolution and knowledge publication.

## 7. Test strategy / threat-driven acceptance

| Threat or state edge                            | Expected result                                        | Regression                                    |
| ----------------------------------------------- | ------------------------------------------------------ | --------------------------------------------- |
| Two proposals share a base; one gets approved   | Other projects as `conflicted` and cannot approve      | `state-transitions.test.ts`                   |
| New proposal submitted against an obsolete base | Reject before storing, HTTP 409                        | `state-transitions.test.ts`                   |
| Terminal proposal modified directly in SQLite   | DB trigger blocks update                               | `state-transitions.test.ts`                   |
| Actor disabled and later re-enabled             | Old token remains revoked                              | `state-transitions.test.ts`                   |
| Human password reset while agent token exists   | Owned agent token revoked                              | `state-transitions.test.ts`                   |
| Duplicate token revocation                      | One audit and stable timestamp                         | `state-transitions.test.ts`                   |
| Opening forum post hidden without thread        | Reject; admin UI guides to thread control              | `state-transitions.test.ts`                   |
| Repeated moderation of same state               | No duplicate audit/event                               | `state-transitions.test.ts`                   |
| UI navigation and review status                 | Skip link, active section, conflict indicator          | `web.test.ts` and `state-transitions.test.ts` |
| MCP projected state matches Web projected state | `proposals_list` shows conflicted while status pending | `state-transitions.test.ts`                   |
| Read-only extension facade attempts write       | Reject 403 before creating a forum thread or proposal  | `extensions.test.ts`                          |
| Public API package upgrades break v1 fixture    | Fail independent package compile/invocation CI gate    | `verify:extension`                            |

**Execution assumptions:** Node.js 24.22.2, Linux x64, `better-sqlite3` native ABI matching Node 24, SQLite WAL, official MCP SDK 2.4.0, one server process. All benchmark/latency claims are **out of scope**; no throughput value has been measured.

**H:** unauthorized or conflicting transitions cannot mutate authoritative state and every approved revision has a durable audit/event trail. **T:** automated service, DB, Web and real MCP integration tests, including migration from an old database. **D:** PASS only when every required test, typecheck and lint succeeds; otherwise FAIL or UNCERTAIN if execution is unavailable. **C:** risks include DB access outside the core, malicious trusted extensions and ambiguous retries after network failures. **U:** major uncertainty is in untested deployments, adversarial third-party code and long-lived operational behavior; no numeric combined standard uncertainty has been calculated without measured inputs.

### Remaining limitations requiring explicit decisions

- OAuth authorization-server integration and client interoperability.
- Idempotency keys for mutating MCP calls; duplicate requests after connection failure.
- Trusted extension supply-chain governance and isolation for untrusted code.
- Operator data-retention/redaction policy for immutable records.
- Human usability tests and real-browser visual/accessibility audit.
- Federation and a real outbox delivery state machine when needed.
