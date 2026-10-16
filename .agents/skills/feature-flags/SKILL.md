---
name: feature-flags
description: Add, read, or remove a feature flag in the web app (`defineFlag`, PostHog, `ENABLE_*` env flags, `useFeatureFlag`, `isFeatureEnabled`, `ShowFeatureFlag`) or the Rust backend (`crates/feature_flags`, config switches). Use when gating, rolling out, or killing a feature, or when asked to "flag it".
---

# Feature flags

Web registry: `apps/web/src/lib/core/constant/featureFlags.ts`. Backend: see
section 5. A flag is never an authorization check.

## 1. Remote or env-only?

| | Remote | Env-only |
|---|---|---|
| Source of truth | PostHog in deployed envs | `default`, optionally overridden by env |
| Discriminator | `key` present | no `key` |
| `env` | optional local override | optional override of `default` |
| `default` | omit / `undefined` to fall through to PostHog | required |
| Readers | `useFeatureFlag`, `ShowFeatureFlag`, `isFeatureEnabled` | `isFeatureEnabled` only |

Most product rollouts are **remote**. Use **env-only** when there is no PostHog
flag and never will be (compile-time / local kill switch).

Ask before assuming. If the user said "flag it" and did not mention PostHog,
prefer remote and confirm.

## 2. Define it

Add one `defineFlag` next to its neighbors. Do not add `ENABLE_*_FLAG` /
`_OVERRIDE` / `ENABLE_*()` triples or a raw PostHog string at the call site.

- `key` (remote): kebab-case, named after the question (`enable-foo`,
  `disable-browser-turso-cache`). Export the object in matching camelCase
  (`enableFoo`).
- `env`: the name after `VITE_`, e.g. `'ENABLE_FOO'` → `VITE_ENABLE_FOO`.
- `default`: used when env is unset. On a remote flag, `false` is a real
  override and **skips PostHog**. On-in-dev / on-in-local is
  `DEV_MODE_ENV || undefined` or `LOCAL_ONLY || undefined`, not the boolean
  itself.
- Never invert on the flag object. If the product question is "disable X",
  invert at the call site (`!isFeatureEnabled(disableX)`).
- Env-only exports that are used as `if (ENABLE_FOO)` must be the boolean:
  `defineFlag({ env, default }).enabled`. The object is always truthy.

```ts
export const enableFoo = defineFlag({
  key: 'enable-foo',
  env: 'ENABLE_FOO',
  default: DEV_MODE_ENV || undefined,
});

export const ENABLE_BAR = defineFlag({
  env: 'ENABLE_BAR',
  default: false,
}).enabled;
```

The PostHog MCP (in the repo's MCP config) can look up existing flags and
their rollout. Don't create or change a PostHog flag without asking which
project and rollout the user wants, and never change a production rollout
without explicit permission.

## 3. Read it

```ts
const foo = useFeatureFlag(enableFoo); // component: foo().enabled
<ShowFeatureFlag flag={enableFoo}>{...}</ShowFeatureFlag>
isFeatureEnabled(enableFoo)            // queries, helpers, env-only
```

A thin `useXFlag` wrapper around `useFeatureFlag(flag)` is fine when several
call sites share the same read. Compose flags in the wrapper (calendar search
requires calendar UI), not on the flag object.

`useFeatureFlag` / `ShowFeatureFlag` take a `RemoteFlag`. Passing an env-only
flag is a type error.

## 4. Get the rollout right

These are the mistakes past flagged launches had to fix:

- **Loading is not off.** Until PostHog answers, `isFeatureEnabled` returns
  `false` and `useFeatureFlag` returns `{ loading: true }`. A cold deep link
  must wait for `loading` to clear rather than fall back to the off path (see
  `block-database`'s `load`), or the page flashes or degrades.
- **Read reactively** (FE-52): call `isFeatureEnabled` / `useFeatureFlag` inside
  a reactive scope, never snapshot it at mount or module load.
- **Gate every entry point**: routes, deep links, previews, copy-link,
  notifications, command menu, mobile surfaces, and agent/MCP tools that
  expose the feature, not just the main button.
- **Off keeps today's behavior.** A flagged change must leave the off path
  exactly as it was.
- **Keep the kill switch.** A remote flag that defaults on (`default: true`)
  can no longer be turned off from PostHog; use `undefined` so PostHog stays in
  control.

## 5. Backend

- **Per-user remote flags** use `crates/feature_flags` (read its `README.md`):
  construct `PostHogFeatureFlags` once at the composition root, load one
  `FlagSnapshot` per authenticated user id, and read it synchronously. A failed
  load returns `Err`; the caller decides the fallback, explicitly. Wire the adapter and its config at the consuming service composition root.
- **Deployment switches** (on for an environment, not per user) are
  `MacroConfig` bools with a default, configured in Doppler (see the config
  rule), not PostHog.
- Keep the backend and web flag keys identical when both gate one feature.

## 6. Remove it

When a flag is fully rolled out, delete the `defineFlag`, every reader, and the
off path in the same change, and say which PostHog flag can be archived.

## Don't

- Migrate existing FLAG / OVERRIDE / string `useFeatureFlag` call sites unless
  you are already changing that flag or were asked to.
- Invent a second helper (`resolveFeatureFlag` for new flags, a global
  `flags.foo` map, `.use()` / `.Show()` on the object).
