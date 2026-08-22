---
name: teo-mode
description: >-
  Teo's working conventions for this repo. Use when the user is Teo, synoet,
  invokes /teo-mode, or asks to work in Teo's style.
disable-model-invocation: true
mode: true
---

# Teo mode

Read `/poteto-mode` and follow it. Do not paste it here. The rules below are this human's overrides.

## Non-negotiables

- Do not invent a UI, login path, table, or crate until you have named how the repo already does the same job.
- Challenge extra types, methods, wrapper structs, and pairing tables. Prefer ordinary functions and the crate that already owns this kind of work.
- Do the idiomatic thing in this PR. Do not postpone Kafka, hashing, or the correct owner as later cleanup.
- Never merge. Never merge-when-ready. "Over the line" and "production-ready" mean a reviewable draft. The human reviews, then lands.
- Proof is a running local stack. Visible changes also need a video. Green CI is not proof. "It works" is not proof.
- Question the existing design when it is wrong. Shipping the plan as written is not the job.

## Autonomy

Do reversible work without asking. Show the result.

Always pause for merge, force-push to shared branches, deploys, data deletion, and real secrets.

Stay on the assigned branch. If another agent already owns that branch or the same task, stop and say so.

If the local stack is broken, dump every running command and stop restarting it.

## Understand first

- Rust under `crates/` or `services/` with `domain`, `inbound`, or `outbound` → `.claude/skills/cloud-storage-hexagonal-architecture/SKILL.md`
- Schema or SQL → `/dump-schema`, then the `[db]` rules in `docs/STYLE_GUIDE.md`
- New UI chrome → Mobbin. Cursor and Linear are the default references. Match the existing side panel and settings pages before inventing layout.
- After writing code, apply `.cursor/commands/simplify.md`. Then confirm the simplification is still correct.

## Code

Reuse the existing component, query, crate, and backfill pattern.

Hide gated UI. If CRM, a flag, or an access check is off, the control is gone, not disabled.

Do not add down migrations.

Nix owns the toolchain. Do not `ensure` or apt-install docker, sqlx, or doppler.

Format touched Rust with `cargo fmt`. Run `just check` on the change.

## Review and verify

Show it. For UI, record the edge cases.

Do not claim a fresh agent can boot the stack unless you booted it in this session.

Do not ship a query that returns entities the viewer cannot see.

## Process

PR title uses Conventional Commits. `feat`, `fix`, `chore`.

PR body is what it solves and how. No test-plan section. No verification checklist.

Push drafts so the human can look. Update every PR in a stack, not just the tip.

Drop work that is not in the requirements. Say so.

## Subagents

Multitask. Use poteto-mode agent routing.

Named reviewers when asked. Fable for a plan. Opus for polish.

Write your own summary. Do not pass through a subagent report.

## Writing the reply

Lead with the outcome or the artifact.

Short sentences. Ask only when the fork is a product call no experiment can settle.

If you cannot say what the user will see, you are not done.
