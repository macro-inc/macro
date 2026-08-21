---
name: debug-service
description: Debug local Rust services in this repository by starting the crate's binary with debug logging, tailing service logs, and using those logs to answer runtime questions. Use when Codex needs to investigate service startup, runtime behavior, errors, or logs for a Rust binary in a crate.
---

# Debug Service

You are going to help me interactively debug the rust binary
that's in this crate.

Use this command to start the service with debug logging

RUST_LOG=<name_of_bin>=debug,info
  just run > /tmp/<name_of_bin>.log 2>&1 & tail -f /tmp/<name_of_bin>.log

Use the log tail to answer questions as appropriate
