# `~/.claude.json` for /etc/skel: `base` plus the settings Claude Code's first
# start writes, so a computer's first session starts as fast as its tenth
# (the first run's migrations cost 0.3-1.3 s of `session/new`). Taken from
# running the pinned Claude Code once at build time against the loopback
# stand-in model in `files/warmup-turn.mjs`, with no credential and no
# network. Only boolean settings and `migrationVersion` are kept: per-install
# values (`userID`, `machineID`, `firstStartTime`, ...) are strings and never
# reach the image.
{
  pkgs,
  claudeCode,
  base,
}:
pkgs.runCommand "claude-first-run.json"
  {
    nativeBuildInputs = [
      pkgs.nodejs_24
      pkgs.jq
    ];
  }
  ''
    export HOME=$TMPDIR/home
    mkdir -p "$HOME"
    cp ${base} "$HOME/.claude.json"
    chmod u+w "$HOME/.claude.json"
    node ${./files/warmup-turn.mjs} stand-in > url &
    stand_in=$!
    until [ -s url ]; do sleep 0.1; done
    ANTHROPIC_BASE_URL=$(cat url) \
      ANTHROPIC_AUTH_TOKEN=macro-warmup-no-credential \
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
      ${pkgs.coreutils}/bin/timeout 120 ${pkgs.lib.getExe claudeCode} -p "Reply with one word." < /dev/null
    kill $stand_in
    first_run=$(jq 'with_entries(select((.value | type) == "boolean" or .key == "migrationVersion"))' "$HOME/.claude.json")
    if [ "$(jq 'has("migrationVersion")' <<< "$first_run")" != true ]; then
      echo "Claude Code's first run wrote no migrationVersion: the seed would be empty" >&2
      exit 1
    fi
    jq --argjson first_run "$first_run" '$first_run + .' ${base} > $out
  ''
