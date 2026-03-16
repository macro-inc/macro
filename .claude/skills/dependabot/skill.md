---
name: dependabot
description: Find all open Dependabot alerts for this repo and create a plan to resolve them using the appropriate package manager overrides (pnpm, bun, npm, cargo).
allowed-tools: Bash, Read, Edit, Glob, Grep, Agent
---

# Dependabot Alert Resolution

## Step 1: Fetch all open alerts

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
gh api "repos/${REPO}/dependabot/alerts" \
  --jq '.[] | select(.state == "open") | {
    number,
    dependency: .dependency.package.name,
    ecosystem: .dependency.package.ecosystem,
    manifest: .dependency.manifest_path,
    vulnerable_range: .security_vulnerability.vulnerable_version_range,
    patched_version: .security_vulnerability.first_patched_version.identifier,
    severity: .security_vulnerability.severity,
    summary: .security_advisory.summary
  }'
```

## Step 2: Group alerts by manifest/lockfile

Group the alerts by their `manifest` field (e.g. `js/app/bun.lock`, `rust/cloud-storage/Cargo.lock`, `js/app/packages/loro-mirror/pnpm-lock.yaml`). This determines which override mechanism to use.

## Step 3: Determine override strategy per manifest

For each manifest/lockfile, determine the correct override mechanism:

| Lockfile | Override mechanism |
|----------|-------------------|
| `bun.lock` / `bun.lockb` | `"overrides"` in the nearest `package.json` |
| `pnpm-lock.yaml` | `"pnpm": { "overrides": { ... } }` in the workspace root `package.json` |
| `package-lock.json` | `"overrides"` in the nearest `package.json` |
| `yarn.lock` | `"resolutions"` in the nearest `package.json` |
| `Cargo.lock` | `cargo update -p <package>` or workspace `[patch.crates-io]` in `Cargo.toml` |

Read each target `package.json` or `Cargo.toml` to check for existing overrides before adding new ones.

## Step 4: Present the plan

Present a table of all alerts grouped by manifest, showing:
- Alert numbers
- Package name
- Current version (from lockfile)
- Patched version
- Severity
- Override mechanism to use

Ask the user to confirm before making changes.

## Step 5: Apply fixes

For each group:

### npm/bun/pnpm overrides
- Add override entries to the appropriate `package.json`
- Reinstall: `bun install` / `pnpm install` / `npm install`
- Verify: check the lockfile or `<pm> ls` for the patched version

### Cargo
- Try `cargo update -p <package>` first
- If that doesn't reach the patched version, also try `cargo update -p <parent-package>` (the package that depends on the vulnerable one, found via `cargo tree -i <package>`)
- Verify with `cargo tree -i <package>` and checking `Cargo.lock`

## Step 6: Verify

After all changes, confirm patched versions are in place and no new audit issues were introduced.

## Notes

- Some alerts may be false positives (e.g. `undici-types` triggering `undici` alerts). Flag these to the user.
- Prefer minimal version bumps (e.g. `>=6.14.0` not `^8.0.0`) to reduce breakage risk.
- If a `cargo update` only bumps to a version below the patch, escalate the parent dependency.
