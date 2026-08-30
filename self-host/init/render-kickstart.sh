#!/usr/bin/env bash
# Render the FusionAuth kickstart from the templates and this deployment's
# environment. Written to /out, which macroctl mounts from ./generated/kickstart.
#
# Google and GitHub identity providers are appended only when real credentials
# are configured. Creating them with placeholder credentials would bake a
# broken-looking connector into FusionAuth — one that appears configured and
# then fails at the callback — which is worse than its plain absence.
set -euo pipefail

TPL=/app/kickstart-templates
OUT=${OUT_DIR:-/out}
mkdir -p "$OUT"

# JSON-escape a value so it can be substituted inside a JSON string literal.
esc() { printf '%s' "${1-}" | jq -Rs 'rtrimstr("\n")' | sed -e 's/^"//' -e 's/"$//'; }

# True when a credential is actually set (not blank, not an `unset-` placeholder).
configured() {
  local v="${1-}"
  [ -n "$v" ] && [ "${v#unset-}" = "$v" ] && [ "${v#REPLACE_ME}" = "$v" ]
}

subst() {
  local content
  content=$(cat "$1")
  shift
  while [ "$#" -gt 0 ]; do
    local key="$1" val="$2"; shift 2
    content=${content//@@${key}@@/$val}
  done
  printf '%s' "$content"
}

SMTP_SECURITY="${SMTP_SECURITY:-TLS}"
case "${SMTP_PORT:-587}" in
  25) SMTP_SECURITY="${SMTP_SECURITY:-NONE}" ;;
  465) SMTP_SECURITY=SSL ;;
esac

base=$(subst "$TPL/kickstart.json.template" \
  FUSIONAUTH_API_KEY                  "$(esc "$FUSIONAUTH_API_KEY")" \
  FUSIONAUTH_TENANT_ID                "$(esc "$FUSIONAUTH_TENANT_ID")" \
  FUSIONAUTH_CLIENT_ID                "$(esc "$FUSIONAUTH_CLIENT_ID")" \
  FUSIONAUTH_CLIENT_SECRET_KEY        "$(esc "$FUSIONAUTH_CLIENT_SECRET_KEY")" \
  FUSIONAUTH_JWT_SIGNING_KEY_ID       "$(esc "$FUSIONAUTH_JWT_SIGNING_KEY_ID")" \
  FUSIONAUTH_PASSWORDLESS_TEMPLATE_ID "$(esc "$FUSIONAUTH_PASSWORDLESS_TEMPLATE_ID")" \
  FUSIONAUTH_OAUTH_REDIRECT_URI       "$(esc "$FUSIONAUTH_OAUTH_REDIRECT_URI")" \
  POPULATE_JWT_LAMBDA_ID              "$(esc "$POPULATE_JWT_LAMBDA_ID")" \
  JWT_SECRET_KEY                      "$(esc "$JWT_SECRET_KEY")" \
  INTERNAL_API_SECRET_KEY             "$(esc "$INTERNAL_API_SECRET_KEY")" \
  ISSUER                              "$(esc "$ISSUER")" \
  APP_BASE_URL                        "$(esc "$APP_BASE_URL")" \
  MAIL_FROM                           "$(esc "$MAIL_FROM")" \
  SMTP_HOST                           "$(esc "$SMTP_HOST")" \
  SMTP_PORT                           "${SMTP_PORT:-587}" \
  SMTP_SECURITY                       "$(esc "$SMTP_SECURITY")" \
  SMTP_USERNAME                       "$(esc "${SMTP_USERNAME:-}")" \
  SMTP_PASSWORD                       "$(esc "${SMTP_PASSWORD:-}")" \
  ADMIN_EMAIL                         "$(esc "$ADMIN_EMAIL")" \
  ADMIN_PASSWORD                      "$(esc "$ADMIN_PASSWORD")")

printf '%s' "$base" | jq . > "$OUT/kickstart.json"

append_requests() {
  local rendered="$1"
  jq --argjson extra "$rendered" '.requests += $extra' "$OUT/kickstart.json" > "$OUT/kickstart.json.tmp"
  mv "$OUT/kickstart.json.tmp" "$OUT/kickstart.json"
}

if configured "${GOOGLE_CLIENT_ID:-}" && configured "${GOOGLE_CLIENT_SECRET_KEY:-}"; then
  reconcile_body=$(esc "$(cat /app/kickstart-templates/reconcile_secondary_idp_link.js)")
  google=$(subst "$TPL/idp-google.json.template" \
    GOOGLE_IDP_ID            "$(esc "$GOOGLE_IDP_ID")" \
    GOOGLE_GMAIL_IDP_ID      "$(esc "$GOOGLE_GMAIL_IDP_ID")" \
    RECONCILE_LAMBDA_ID      "$(esc "$RECONCILE_LAMBDA_ID")" \
    RECONCILE_LAMBDA_BODY    "$reconcile_body" \
    GOOGLE_CLIENT_ID         "$(esc "$GOOGLE_CLIENT_ID")" \
    GOOGLE_CLIENT_SECRET_KEY "$(esc "$GOOGLE_CLIENT_SECRET_KEY")" \
    FUSIONAUTH_CLIENT_ID     "$(esc "$FUSIONAUTH_CLIENT_ID")")
  append_requests "$google"
  echo "  google identity providers: configured"
else
  echo "  google identity providers: skipped (no credentials)"
fi

if configured "${GITHUB_CLIENT_ID:-}" && configured "${GITHUB_CLIENT_SECRET:-}"; then
  github=$(subst "$TPL/idp-github.json.template" \
    GITHUB_IDP_ID        "$(esc "$GITHUB_IDP_ID")" \
    GITHUB_CLIENT_ID     "$(esc "$GITHUB_CLIENT_ID")" \
    GITHUB_CLIENT_SECRET "$(esc "$GITHUB_CLIENT_SECRET")" \
    FUSIONAUTH_CLIENT_ID "$(esc "$FUSIONAUTH_CLIENT_ID")")
  append_requests "$github"
  echo "  github identity provider: configured"
else
  echo "  github identity provider: skipped (no credentials)"
fi

# Fail loudly rather than handing FusionAuth a file it will reject at boot.
jq -e '.requests | length > 0' "$OUT/kickstart.json" >/dev/null
if grep -q '@@' "$OUT/kickstart.json"; then
  echo "unsubstituted markers remain in kickstart.json:" >&2
  grep -o '@@[A-Z_]*@@' "$OUT/kickstart.json" | sort -u >&2
  exit 1
fi
echo "  wrote $OUT/kickstart.json ($(jq '.requests | length' "$OUT/kickstart.json") requests)"
