# Hosted OpenBao (dev)

Passwords keeps its secret values in OpenBao; Postgres holds only metadata. The
local stack runs OpenBao from `infra/local/openbao`. This stack is the hosted dev
vault that QA uses.

| Piece | Choice |
| --- | --- |
| Server | `quay.io/openbao/openbao:2.7.2` (digest-pinned), one Fargate task on the shared cluster |
| Storage | Integrated Raft, node `macro-dev`, on encrypted EFS through an access point (uid 100, mode 0700); IAM + TLS mount only |
| Seal | `awskms`, key `alias/openbao-dev`, rotation on; only the task role may use it |
| Backup | AWS Backup vault `openbao-dev`, daily at 05:00 UTC, kept 14 days |
| TLS | Internal ALB, ACM certificate for `openbao-dev.macro-internal.com`, TLS 1.2+/1.3 policy |
| Access | ALB ingress 443 only from the document storage service's security group; task port 8200 only from the ALB |
| Audit | Declared device `passwords`, `file_path = stdout`, `log_raw = false`; FireLens ships it to Datadog as `service:openbao` (and to Grafana in dev) |
| Alarms | ECS deployment failure; no healthy target for 5 minutes |

Server limits match local: `default_max_request_duration = "90s"`, and no JWT
leeway, so DSS and the vault must keep synchronized clocks (Fargate uses Amazon
Time Sync).

## First deploy and init (once)

1. Deploy the stack (explicit permission required). The task becomes healthy
   while uninitialized.
2. Create the Doppler project `openbao` with a `dev` config only.
3. Forward the task's API port over SSM (ECS Exec is enabled) and initialize
   with a local `bao` CLI (`nix shell nixpkgs#openbao`). The credentials go
   straight into Doppler and are never printed:

   ```sh
   cluster=<cloudStorageClusterName output of the document-storage dev stack>
   task=$(aws ecs list-tasks --cluster "$cluster" --service-name openbao \
     --query 'taskArns[0]' --output text)
   runtime=$(aws ecs describe-tasks --cluster "$cluster" --tasks "$task" \
     --query "tasks[0].containers[?name=='openbao'].runtimeId | [0]" --output text)
   aws ssm start-session --target "ecs:${cluster}_${task##*/}_${runtime}" \
     --document-name AWS-StartPortForwardingSession \
     --parameters '{"portNumber":["8200"],"localPortNumber":["18200"]}' &
   bao operator init -address=http://127.0.0.1:18200 \
     -recovery-shares=1 -recovery-threshold=1 -format=json \
     | jq '{OPENBAO_ROOT_TOKEN: .root_token, OPENBAO_RECOVERY_KEY: .recovery_keys_b64[0]}' \
     | doppler secrets upload -p openbao -c dev /dev/stdin > /dev/null
   kill %1
   ```

   With KMS auto-unseal the vault unseals itself on every restart. The recovery
   key is only for `bao operator generate-root`.

## Provisioning (follow-up)

Team namespaces, mounts, JWT roles, and the lifecycle role are applied by a
hosted provisioning entrypoint. It is not in this stack yet: it lands with the
Passwords change, reuses the local bootstrap's policy and role logic, and
accepts only this exact HTTPS origin. Until then, no team can use the vault.

The document storage service's dev Doppler config gets `OPENBAO_ADDRESS`,
`PASSWORDS_JWT_ISSUER`, and `PASSWORDS_JWT_SIGNING_KEY` together at
provisioning time; it refuses a partial set. Only explicitly provisioned teams
work, because creating a team does not create its namespace.

## Restore

Restore the latest AWS Backup recovery point of the EFS file system, either to a
new file system or to a directory on this one. Point the access point at the
restored `/openbao` directory and redeploy. The seal key must still exist. The
copy is file-level and crash-consistent; Raft replays its log on start.

## Prod later

Not built. A separate design decides:

- **Cluster:** 3-node HA Raft on EC2 with EBS across three AZs (`retry_join`
  by tag); Raft on network storage is not recommended beyond dev.
- **TLS:** end to end: node certificates, an HTTPS target group, and TLS on
  `cluster_addr`.
- **Backup:** scheduled `bao operator raft snapshot save` to a versioned,
  object-locked bucket, a tested restore, and cross-region copies of the backups
  and the KMS key.
- **Credentials and provisioning:** a separate prod KMS key and Doppler
  config; the root token revoked after provisioning; recovery keys split across
  operators; a scoped provisioner identity; automatic namespace provisioning on
  team creation.
- **Service URL:** `OPENBAO_ADDRESS` becomes a typed `macro_service_urls` entry.
- **Monitoring:** telemetry to Grafana/Datadog; seal, leader, and Raft-commit
  alerts; audit logs retained in immutable storage.
