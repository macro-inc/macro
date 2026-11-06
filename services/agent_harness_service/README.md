# Agent harness service

The single agent backend hosts sessions, chat/completions, workspace MCP/OAuth,
routine scheduling, and previews. Public HTTP, session egress, preview HTTP, and
SSH are listeners in the same process. One ECS service runs two replicas in
both dev and production, with rolling task replacement.

Read [AGENTS.md](AGENTS.md) for the module map and checks, and the
[consolidation guide](../../docs/guides/consolidate-agent-services.md) before
cutting over existing deployments. Preview networking and the projection queue
remain in resource-only stacks, along with the original public cognition/MCP
DNS records. Their URLs and OAuth callbacks stay unchanged while the shared
gateway routes them to the harness; connection gateway is app-wide realtime.

Use the [local development guide](../../docs/development/running-locally.md)
for local stack setup. Configuration belongs to the `agent-harness-service`
Doppler project; all nested feature configs are validated by its config binary.

Preview forwarding rejects overload with HTTP 429 before opening a socket.
Owner-side per-preview HTTP streams retain their existing queueing behavior.

SSH disconnection and an owner-local stop cancel open preview traffic immediately.
A stop or re-share on another replica closes the old transport on its next
ten-second sweep.

The preview network stack exports `previewTaskSecurityGroupId`,
`previewControlTargetGroupArn`, `previewHttpTargetGroupArn`, and
`previewSshTargetGroupArn` for the harness to reuse the existing network resources.
