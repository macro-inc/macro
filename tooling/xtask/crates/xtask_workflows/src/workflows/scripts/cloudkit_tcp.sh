#!/usr/bin/env bash
set -euo pipefail
umask 077

if [ "$#" -eq 0 ]; then
  echo 'Usage: cloudkit_tcp.sh <dmg-or-app> [<dmg-or-app> ...]' >&2
  exit 2
fi

# The only traffic filtered is UDP/443 to Apple's published CloudKit ticket
# delivery ranges. TCP/443 remains available for stapler's HTTP/2 fallback.
# https://developer.apple.com/documentation/security/customizing-the-notarization-workflow
pf_dir=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/macro-cloudkit-pf.XXXXXX")
pf_rules="$pf_dir/rules"
anchor="com.apple/macro_cloudkit_${GITHUB_RUN_ID:-0}_${GITHUB_RUN_ATTEMPT:-0}_${pf_dir##*.}"
pf_token=''
pf_loaded=0

cleanup() {
  local status=$? attempt rules tables counters packets cleared=0
  trap - EXIT
  if [ "$pf_loaded" -eq 1 ]; then
    if counters=$(sudo -n pfctl -a "$anchor" -vvsr 2> /dev/null); then
      packets=$(printf '%s\n' "$counters" | awk '/Packets:/ {
        for (i = 1; i <= NF; i++) if ($i == "Packets:") total += $(i + 1)
      } END { print total + 0 }')
      echo "CloudKit ticket UDP/443 blocked packets=$packets"
      if [ "$packets" -eq 0 ]; then
        echo '::warning::No CloudKit UDP/443 packets were blocked; stapler may have chosen TCP without PF intervention'
      fi
    else
      echo '::warning::Could not read CloudKit PF packet counters'
    fi
    for attempt in 1 2 3; do
      if sudo -n pfctl -a "$anchor" -F rules > /dev/null 2>&1 &&
        sudo -n pfctl -a "$anchor" -F Tables > /dev/null 2>&1 &&
        rules=$(sudo -n pfctl -a "$anchor" -sr 2> /dev/null) &&
        tables=$(sudo -n pfctl -a "$anchor" -s Tables 2> /dev/null) &&
        [ -z "$rules" ] && [ -z "$tables" ]; then
        cleared=1
        break
      fi
      sleep 1
    done
    if [ "$cleared" -ne 1 ]; then
      echo "Failed to clear and verify CloudKit PF anchor $anchor; discard this runner" >&2
      # Keep our enable reference if another component also has PF enabled;
      # releasing it could leave the uncleared anchor active under theirs.
      rm -rf "$pf_dir" || true
      exit 1
    fi
  fi
  if [ -n "$pf_token" ] && ! sudo -n pfctl -X "$pf_token" > /dev/null; then
    echo 'Failed to release CloudKit PF enable reference; discard this runner' >&2
    status=1
  fi
  if ! rm -rf "$pf_dir"; then
    echo 'Failed to remove temporary CloudKit PF rules' >&2
    status=1
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

cat > "$pf_rules" <<'RULES'
block return out quick inet proto udp from any to 17.36.196.0/22 port 443
block return out quick inet proto udp from any to 17.57.0.0/22 port 443
block return out quick inet proto udp from any to 17.248.128.0/17 port 443
block return out quick inet proto udp from any to 17.250.48.0/20 port 443
block return out quick inet proto udp from any to 17.250.64.0/18 port 443
block return out quick inet proto udp from any to 17.252.62.0/23 port 443
block return out quick inet6 proto udp from any to 2403:300:a41::/48 port 443
block return out quick inet6 proto udp from any to 2403:300:a50:100::/56 port 443
block return out quick inet6 proto udp from any to 2403:300:1360::/44 port 443
block return out quick inet6 proto udp from any to 2403:300:1502::/48 port 443
block return out quick inet6 proto udp from any to 2620:149:a40::/46 port 443
block return out quick inet6 proto udp from any to 2620:149:1360::/44 port 443
block return out quick inet6 proto udp from any to 2a01:b740:984::/56 port 443
block return out quick inet6 proto udp from any to 2a01:b740:984:100::/64 port 443
block return out quick inet6 proto udp from any to 2a01:b740:a41::/48 port 443
block return out quick inet6 proto udp from any to 2a01:b740:1360::/44 port 443
RULES

# The standard macOS com.apple/* parent anchor must evaluate our child rules.
# Fail the release rather than silently running unprotected if that changes.
sudo -n pfctl -s info > /dev/null
main_rules=$(sudo -n pfctl -sr)
if [[ "$main_rules" != *'anchor "com.apple/*" all'* ]]; then
  echo 'The macOS com.apple/* PF anchor is not active' >&2
  exit 1
fi
sudo -n pfctl -n -a "$anchor" -f "$pf_rules" > /dev/null

# Record references before -E so an unexpected token format can still be
# recovered. No filtering rules are loaded until the token is known.
refs_before=$(sudo -n pfctl -s References)
enable_output=$(sudo -n pfctl -E 2>&1)
pf_token=$(printf '%s\n' "$enable_output" |
  awk 'tolower($0) ~ /token[[:space:]]*:/ { print $NF; exit }')
if [[ ! "$pf_token" =~ ^(0x[[:xdigit:]]+|[[:digit:]]+)$ ]]; then
  pf_token=$(comm -13 <(printf '%s\n' "$refs_before" | sort) \
    <(sudo -n pfctl -s References | sort) |
    awk '$1 ~ /^[0-9]+$/ && $3 ~ /^(0x[0-9a-fA-F]+|[0-9]+)$/ { print $3 }' |
    sort -u)
  if [[ ! "$pf_token" =~ ^(0x[[:xdigit:]]+|[[:digit:]]+)$ ]]; then
    pf_token=''
    echo 'Could not recover the PF enable token; no CloudKit rules were loaded. Discard this runner' >&2
    exit 1
  fi
  echo 'Unexpected PF enable output; recovered and will release its token' >&2
  exit 1
fi

if ! sudo -n pfctl -s info | grep -Eq '^Status: Enabled'; then
  echo 'PF did not become active' >&2
  exit 1
fi

# Mark it loaded before the command: even a partial load must be flushed.
pf_loaded=1
sudo -n pfctl -a "$anchor" -f "$pf_rules" > /dev/null
rules=$(sudo -n pfctl -a "$anchor" -sr)
if [ "$(printf '%s\n' "$rules" | awk 'END { print NR }')" -ne 2 ] ||
  ! printf '%s\n' "$rules" | grep -Eq '^block return out quick inet proto udp from any to <__automatic_[[:xdigit:]_]+> port = 443$' ||
  ! printf '%s\n' "$rules" | grep -Eq '^block return out quick inet6 proto udp from any to <__automatic_[[:xdigit:]_]+> port = 443$'; then
  echo 'CloudKit PF rules did not compile to the expected IPv4 and IPv6 UDP/443 table rules' >&2
  exit 1
fi

echo 'CloudKit ticket UDP/443 guard active; stapler can use TCP/443'
for target in "$@"; do
  xcrun stapler staple -v "$target"
  xcrun stapler validate -v "$target"
done
