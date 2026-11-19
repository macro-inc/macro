#!/usr/bin/env bash
# docker compose on the subr instance, with my extra override.
export MACRO_ENV_FILE="$HOME/.herdr/worktrees/macro/synoet-routines-draft-subroutines/infra/local/generated/subr/local.generated.env"
exec docker compose --project-directory "$HOME/.herdr/worktrees/macro/synoet-routines-draft-subroutines" -p macro-subr -f "$HOME/.herdr/worktrees/macro/synoet-routines-draft-subroutines/docker/docker-compose.yml" -f "$HOME/.herdr/worktrees/macro/synoet-routines-draft-subroutines/infra/local/generated/subr/docker-compose.override.yml" -f "$HOME/.cache/routines-draft-subroutines/extra.override.yml" --env-file "$HOME/.herdr/worktrees/macro/synoet-routines-draft-subroutines/infra/local/generated/subr/local.generated.env" "$@"
