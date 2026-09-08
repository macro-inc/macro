---
name: define-feature-flag
description: Define a frontend feature flag with `defineFlag` and wire its readers. Use when adding, suggesting, or changing a feature flag, PostHog flag, `ENABLE_*` env flag, `useFeatureFlag`, `isFeatureEnabled`, or `ShowFeatureFlag`.
---

# Define a frontend feature flag

Frontend only. Registry: `apps/web/src/lib/core/constant/featureFlags.ts`.
There is no shared backend flag system.

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

Do not create the PostHog flag. Ask which project / environment it should live
in and wait.

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

## Don't

- Migrate existing FLAG / OVERRIDE / string `useFeatureFlag` call sites unless
  you are already changing that flag or were asked to.
- Invent a second helper (`resolveFeatureFlag` for new flags, a global
  `flags.foo` map, `.use()` / `.Show()` on the object).
