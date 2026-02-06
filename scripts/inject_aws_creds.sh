#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${1:-.env}"
CREDS_FILE="${HOME}/.aws/credentials"
PROFILE="${AWS_PROFILE:-default}"

if [[ ! -f "$CREDS_FILE" ]]; then
  echo "error: $CREDS_FILE not found" >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "error: $ENV_FILE not found" >&2
  exit 1
fi

# Parse credentials for the given profile
in_profile=false
access_key=""
secret_key=""

while IFS= read -r line; do
  if [[ "$line" =~ ^\[${PROFILE}\] ]]; then
    in_profile=true
    continue
  fi
  if [[ "$line" =~ ^\[.+\] ]]; then
    in_profile=false
    continue
  fi
  if $in_profile; then
    if [[ "$line" =~ ^aws_access_key_id[[:space:]]*=[[:space:]]*(.*) ]]; then
      access_key="${BASH_REMATCH[1]}"
    elif [[ "$line" =~ ^aws_secret_access_key[[:space:]]*=[[:space:]]*(.*) ]]; then
      secret_key="${BASH_REMATCH[1]}"
    fi
  fi
done < "$CREDS_FILE"

if [[ -z "$access_key" || -z "$secret_key" ]]; then
  echo "error: could not find credentials for profile [$PROFILE]" >&2
  exit 1
fi

sed -i '' "s|^AWS_ACCESS_KEY_ID=.*|AWS_ACCESS_KEY_ID=\"${access_key}\"|" "$ENV_FILE"
sed -i '' "s|^AWS_SECRET_ACCESS_KEY=.*|AWS_SECRET_ACCESS_KEY=\"${secret_key}\"|" "$ENV_FILE"

echo "injected [$PROFILE] credentials into $ENV_FILE"
