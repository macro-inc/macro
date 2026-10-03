
### Repositories in native Herdr sessions

Macro can include `repoUrl` when opening a session on macrod. Native Herdr
sessions look for the matching origin in the configured workspace directory
(and its child directories), then in this daemon's repository cache. A missing
repository is cloned using the operator's Git credentials. New worktrees start
from a fresh fetch of `origin/main`; macrod never pulls into the operator's
working branch. A repository without `main` produces an error.

Herdr creates and registers the worktree. The session ID determines its path
and branch, so redelivery reuses existing work without resetting edits. Cached
repositories and worktrees live under `~/.macrod/herdr/<harness-id>/`. Each
paired macrod instance has one configuration and its own storage directory.
