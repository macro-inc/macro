---
name: new-service
description: Create and register a new deployable service (Rust ECS service, worker, Kafka consumer, or Cloudflare Worker). Use when adding a directory under services/, a new Pulumi stack, or wiring an existing binary for deployment.
---

# New service

Follow [docs/guides/new-service.md](../../../docs/guides/new-service.md)
section by section. It is the checklist; this skill makes sure none of it is skipped.

1. Pick the model to copy from the guide's table and say which one.
2. Make a task list with one item per guide section that applies (crate, deploy
   inventory, infrastructure, config and secrets, service discovery, local stack,
   API clients, Kafka topics). Mark sections that don't apply, with the reason.
3. Work through the list. For each section, re-read it in the guide before
   editing; the pitfalls are inline.
4. Run the guide's "Verify locally" commands and report each result.
5. Do not deploy, create Doppler values, or remove `bootstrap_pending`. List
   those as follow-ups for the user, with the exact steps from "After merge".
