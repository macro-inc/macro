# Runs files/claude-wrapper against a fake claude that prints what it got:
# no credential, a credential, an unreadable one and one without a token.
{ pkgs }:
pkgs.runCommand "macro-box-claude-wrapper" { nativeBuildInputs = [ pkgs.jq ]; } ''
  fake=$TMPDIR/fake-claude
  cat > $fake <<'FAKE'
  #!${pkgs.runtimeShell}
  echo "arguments=$*"
  echo "base_url=''${ANTHROPIC_BASE_URL-unset}"
  echo "auth_token=''${ANTHROPIC_AUTH_TOKEN-unset}"
  echo "api_key=''${ANTHROPIC_API_KEY-unset}"
  echo "nonessential=''${CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC-unset}"
  echo "oauth=''${CLAUDE_CODE_OAUTH_TOKEN-unset}"
  FAKE
  chmod +x $fake
  credential=$TMPDIR/claude/credential.json
  sed -e "s|@credential@|$credential|" -e "s|@jq@|jq|" -e "s|@claude@|$fake|" \
    ${./files/claude-wrapper} > wrapper
  run() {
    ANTHROPIC_BASE_URL=https://gateway ANTHROPIC_AUTH_TOKEN=gateway-key \
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
      ${pkgs.bash}/bin/bash -euo pipefail wrapper --print hi 2> stderr
  }
  gateway='arguments=--print hi
  base_url=https://gateway
  auth_token=gateway-key
  api_key=unset
  nonessential=1
  oauth=unset'

  # No sign-in: the gateway env, unchanged and silent.
  [ "$(run)" = "$gateway" ]
  [ ! -s stderr ]

  # A sign-in: only the Claude token.
  mkdir -p $TMPDIR/claude
  echo '{"token":"sk-ant-oat01-TEST","expires_at":null,"created_at":"2026-11-11T00:00:00Z"}' > $credential
  [ "$(run)" = 'arguments=--print hi
  base_url=unset
  auth_token=unset
  api_key=unset
  nonessential=unset
  oauth=sk-ant-oat01-TEST' ]
  [ ! -s stderr ]

  # Unreadable, or no token: the gateway env and a warning without the token.
  chmod 000 $credential
  [ "$(run)" = "$gateway" ]
  grep -q 'unreadable; using Macro credits' stderr
  chmod 600 $credential
  echo '{}' > $credential
  [ "$(run)" = "$gateway" ]
  grep -q 'unreadable; using Macro credits' stderr
  touch $out
''
