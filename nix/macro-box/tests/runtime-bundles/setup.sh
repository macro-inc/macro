#!/usr/bin/env bash
set -euo pipefail
bin=/run/current-system/sw/bin
export PATH="$bin:$PATH"
bun=$(printf '%s\n' /nix/store/*-bun-1.4.2/bin/bun | head -n1)
[[ -x $bun ]]
install -d -m 755 /home/.macro-agent-runtime /run/macro-agent-runtime /run/macro-agent-pause
install -d -m 700 -o macro -g macro /run/macro-agent-runtime/receipts /home/macro/.fixture /home/macro/agent/workspace /home/macro/agent/state
image=/opt/fixture/image
install -d -m 755 "$image/node_modules/@macro-inc/muppet/"{host,core} /opt/fixture/bin
cp /fixture/host/maintenance.ts "$image/node_modules/@macro-inc/muppet/host/"
cp /fixture/core/maintenance.ts "$image/node_modules/@macro-inc/muppet/core/"
cat > /opt/fixture/candidate.json <<'JSON'
{"name":"agent-fixture","muppetApi":4,"dependencies":{"x":"1.0.0"}}
JSON
cp /opt/fixture/candidate.json /opt/fixture/image/template.json
cp /opt/fixture/candidate.json /home/macro/agent/workspace/package.json
echo '{"apiLevel":4}' >/opt/fixture/image/node_modules/@macro-inc/muppet/package.json
cp /fixture/service.ts /home/macro/agent/workspace/cli.ts
echo '{}' >"$image/bun.lock"
cp "$image/bun.lock" /home/macro/agent/workspace/bun.lock
chown -R macro:macro /home/macro/agent/workspace
runuser -u macro -- git -C /home/macro/agent/workspace init -q
runuser -u macro -- git -C /home/macro/agent/workspace remote add origin https://fixture.example.com/repo
runuser -u macro -- git -C /home/macro/agent/workspace add package.json bun.lock cli.ts
if ! runuser -u macro -- git -C /home/macro/agent/workspace diff --cached --quiet; then
  runuser -u macro -- git -C /home/macro/agent/workspace -c user.name=Fixture -c user.email=fixture@example.com commit -qm baseline
fi
for file in events done log; do runuser -u macro -- touch "/home/macro/.fixture/$file"; done
cat > /opt/fixture/bin/curl <<CURL
#!$bin/bash
set -eu
while [[ \$1 != --output ]]; do shift; done
cp /fixture/archive "\$2"
CURL
chmod +x /opt/fixture/bin/curl
{
  echo "#!$bin/bash"
  cat <<CONFIG
set -euo pipefail
export PATH=/opt/fixture/bin:$bin
self=\$0
workspace=/home/macro/agent/workspace
last_good=/home/macro/agent/state/last-good
boot_head=/home/macro/agent/state/boot-head
restart_marker=/home/macro/agent/.restart
bundles=/home/.macro-agent-runtime
control=/run/macro-agent-runtime
pause=/run/macro-agent-pause
image_runtime=/opt/fixture/image
drain_timeout=4
ready_timeout=4
CONFIG
  cat /fixture/update
} >/opt/fixture/bin/update
chmod +x /opt/fixture/bin/update
install -d /run/systemd/system/macro-agent.service.d
cat > /opt/fixture/agent.env <<ENV
MACRO_REPO_URL=https://fixture.example.com/repo
MACRO_REPO_TOKEN=fixture
MACRO_AGENT_USER_ID=macro|fixture@example.com
MACRO_AGENT_NAME=Fixture
ENV
{
  echo "#!$bin/bash"
  cat <<SCRIPT
set -euo pipefail
export PATH=$(dirname "$bun"):$bin
export MUPPET_CREDENTIALS_FILE=/opt/fixture/agent.env
workspace=/home/macro/agent/workspace
last_good=/home/macro/agent/state/last-good
failures=/home/macro/agent/state/failed-boots
boot_head=/home/macro/agent/state/boot-head
max_failed_boots=3
runtime=$image
runtime_bundles=/home/.macro-agent-runtime
runtime_control=/run/macro-agent-runtime
helper=/run/current-system/sw/bin/false
helper_credentials=unused
setup_traceparent=/run/fixture-traceparent
setup_traceparent_used=/run/fixture-traceparent-used
SCRIPT
  cat /fixture/agent-env-setting /fixture/start-agent
} >/opt/fixture/bin/start-agent
chmod +x /opt/fixture/bin/start-agent
cat > /run/systemd/system/macro-agent.service.d/fixture.conf <<UNIT
[Unit]
ConditionPathExists=
Wants=
After=
[Service]
ExecStart=
ExecStart=/opt/fixture/bin/start-agent run
ExecStopPost=
WorkingDirectory=/home/macro
ProtectHome=no
ProtectSystem=no
BindPaths=
BindReadOnlyPaths=
LoadCredential=
ReadWritePaths=
InaccessiblePaths=
Restart=no
Group=macro
UNIT
cat > /run/systemd/system/macro-agent-runtime-recover.service <<UNIT
[Service]
Type=oneshot
ExecStart=/opt/fixture/bin/update recover
UNIT
install -d /run/systemd/system/macrod.service.d
cat > /run/systemd/system/macrod.service.d/fixture.conf <<UNIT
[Unit]
ConditionPathExists=
Wants=
After=
[Service]
ExecStart=
ExecStart=$bin/sleep infinity
UNIT
systemctl daemon-reload
systemctl restart macrod macro-agent
