#!/usr/bin/env bash
# Register a disabled placeholder `google_gmail` OIDC IdP in the channels FusionAuth
# (no Google creds locally; the agent harness needs the IdP to exist at startup).
set -euo pipefail
D=/nix/store/lwdlqqz8byqp1vpblkjpbcdywnqgba90-docker-29.9.2/bin/docker
REPO=/home/teo/.herdr/worktrees/macro/synoet-channels-local-sync
FA=http://localhost:${FA_PORT:?set FA_PORT}
for _ in $(seq 1 360); do
  if $D ps --filter name=macro-channels-b-agent --format '{{.Names}}' | grep -q . \
     && [ "$($D inspect -f '{{.State.Health.Status}}' macro-channels-b-fusionauth-1 2>/dev/null)" = healthy ]; then
    break
  fi
  sleep 5
done
KEY=$(grep -E "^FUSIONAUTH_API_KEY=" $REPO/infra/local/generated/channels-b/local.generated.env | head -1 | cut -d= -f2- | tr -d '"')
APP=$(grep -E "^FUSIONAUTH_CLIENT_ID=" $REPO/infra/local/generated/channels-b/local.generated.env | head -1 | cut -d= -f2- | tr -d '"')
curl -s -o /dev/null -w "GET existing: %{http_code}\n" -H "Authorization: $KEY" $FA/api/identity-provider/55555555-5555-4555-8555-555555555555
curl -s -w "\nPOST: %{http_code}\n" -X POST -H "Authorization: $KEY" -H 'Content-Type: application/json' \
  $FA/api/identity-provider/55555555-5555-4555-8555-555555555555 -d @- <<JSON
{"identityProvider":{"type":"OpenIDConnect","name":"google_gmail","enabled":false,"buttonText":"GoogleGmail",
 "oauth2":{"client_id":"placeholder","client_secret":"placeholder","scope":"openid profile email",
 "authorization_endpoint":"https://accounts.google.com/o/oauth2/v2/auth","token_endpoint":"https://oauth2.googleapis.com/token",
 "userinfo_endpoint":"https://openidconnect.googleapis.com/v1/userinfo","clientAuthenticationMethod":"client_secret_post"}}}
JSON
