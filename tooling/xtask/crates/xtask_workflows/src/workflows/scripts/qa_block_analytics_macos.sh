set -euo pipefail

# The release app embeds the production PostHog key. Without this, every QA
# launch would count the runner as a new desktop user. Point the analytics
# proxy at nothing for this runner; the host is read from the web app, which
# owns it, so the two cannot drift apart.
host=$(sed -n "s#^[[:space:]]*api_host: 'https://\([^/']*\).*#\1#p" apps/web/src/lib/analytics/analytics.ts)
if [ -z "$host" ]; then
  echo "::error::could not read the PostHog api_host from apps/web/src/lib/analytics/analytics.ts" >&2
  exit 1
fi

printf '0.0.0.0 %s\n:: %s\n' "$host" "$host" | sudo tee -a /etc/hosts >/dev/null
sudo dscacheutil -flushcache
sudo killall -HUP mDNSResponder || true

# Refuse to launch the app while analytics are still reachable.
if curl --silent --max-time 10 --output /dev/null "https://$host/"; then
  echo "::error::$host is still reachable after blocking it in /etc/hosts" >&2
  exit 1
fi
echo "Blocked analytics host $host for this job"
