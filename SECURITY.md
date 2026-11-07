# Security policy

**MVP candidate, not production-certified.** See [Security model](docs/SECURITY_MODEL.md) for security boundaries, protections and limitations.

## Reporting vulnerabilities

Please avoid public issues for exploitable security defects. Use GitHub's private vulnerability reporting or Security Advisories for this repository **when enabled**. If private reporting is unavailable, request a secure reporting channel from a maintainer without posting exploit details or secrets publicly. No response SLA is promised at this stage.

## Supported versions

Until the first stable release, only the latest maintained default-branch revision is intended for security fixes. Community-maintained extensions are outside the core support guarantee; operators must vet and update them.

## Deployment precautions

Use HTTPS, a persistent backup strategy and a current Node 24 security release. Keep `APP_ORIGIN` accurate, limit CLI filesystem access, restrict installed extensions, revoke leaked tokens immediately and do not expose the development server publicly. This MVP does **not** implement OAuth; tokens are static bearer credentials. Never run arbitrary uploaded code or untrusted extensions.
