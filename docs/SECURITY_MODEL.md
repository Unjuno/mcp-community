# Security model

## Assets and adversaries

Protect user credentials, session/token secrets, approved knowledge, private community discussion and extension execution authority. Threat actors include anonymous clients, compromised agents, ordinary members, malicious posts and unreviewed extension packages.

## Boundaries and controls

- Shared service authorization prevents adapter-specific privilege bypass.
- Human admin checks additionally constrain channel and actor kind; token scope never grants administrative review.
- Parameterized typed database queries; bounded Zod schemas; escaped plain-text SSR.
- Hashed random sessions and tokens, scrypt password hashing, expiry, revocation and session rotation.
- Synchronizer CSRF tokens and exact configured-Origin checks for every browser mutation, including login/logout.
- Strict Host/Origin validation for MCP, body limits, security headers and persistent rate limiting.
- Knowledge approval, revision append and audit/outbox are one transaction; stale proposals cannot overwrite newer content.
- Audit metadata is allowlisted and excludes passwords, bearer tokens, cookies, CSRF values and content bodies.
- Installed extension code has process-level privileges. Only reviewed packages are allowed; it can bypass application controls and is not isolated.

## Explicit limitations

The initial bearer-token mode is not OAuth 2.1. TLS/reverse-proxy configuration, OS patching, backup access control and installed extension review remain the operator's responsibility. Prompt injection cannot be eliminated by a storage server: downstream clients must treat posts/resources as untrusted data and require approval for consequential actions. No security audit or production-readiness certification is claimed.
