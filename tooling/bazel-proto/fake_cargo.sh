#!/bin/sh
# sqlx-macros 0.8.6 asks `cargo metadata` for the workspace root to find .sqlx. Bazel's
# compile actions have no cargo, so answer with the root rustc was started in.
printf '{"workspace_root":"%s"}\n' "$BAZEL_WS_ROOT"
