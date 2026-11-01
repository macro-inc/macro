---
description: "Guard against a repeated mistake with the checks the repository already runs (ast-grep, oxlint, Biome, clippy, a test), not a new tool."
paths:
  - "tooling/**"
  - "rules/ast-grep/**"
  - "sgconfig.yml"
  - ".github/workflows/**"
  - "**/.oxlintrc.json"
  - "**/biome*.jsonc"
  - "clippy.toml"
  - "**/eslint.config.*"
  - "**/.eslintrc*"
globs: "tooling/**,rules/ast-grep/**,sgconfig.yml,.github/workflows/**,**/.oxlintrc.json,**/biome*.jsonc,clippy.toml,**/eslint.config.*,**/.eslintrc*"
alwaysApply: false
---

# Add checks to the tools the repository already runs

A browser-floor guard once arrived as a new ESLint package: its own lockfile,
CI install steps and about 900 lines. All it caught was two API calls that two
ast-grep patterns now catch.

- Write a structural "never write this" check as an ast-grep rule in
  `rules/ast-grep/`, as a `ts-`/`tsx-` pair for TypeScript.
- Before writing a rule, look for one in a linter the repository already runs:
  oxlint, Biome or clippy. Check behaviour with a test.
- Cover the mistake that happened and its close relatives, not every possible
  variant.
- Ask the user before adding a linter, a tool package or a dependency for a
  check.
- A check that must block merging runs in a required CI job. Conventions, which
  runs every ast-grep rule, isn't required.

Check: the change adds no new linter configuration, tool package or lockfile for
a check, and each new check fails on the mistake it guards against.
