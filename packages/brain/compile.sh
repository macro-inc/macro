#!/usr/bin/env bash
# Compiler options must precede the entrypoint; later arguments are embedded
# into the executable as its default application arguments.
set -euo pipefail
deno compile --no-code-cache --allow-net --allow-read=/home,/tmp --allow-write=/home,/tmp --allow-run=git,claude --allow-env --allow-sys=homedir,osRelease,hostname,uid,gid --exclude node_modules/.deno/@anthropic-ai+claude-agent-sdk-linux-x64@0.3.318/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64 --exclude node_modules/.deno/@anthropic-ai+claude-agent-sdk-linux-x64-musl@0.3.318/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64-musl --output dist/brain "$@" src/main.ts
