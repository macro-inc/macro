# Hosted OpenBao (dev)

Passwords keeps its secret values in OpenBao; Postgres holds only metadata. The
Passwords change adds a local OpenBao to the local stack; this stack is the
hosted dev vault that QA uses.

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

The server's `default_max_request_duration` (90 s) matches local; the ALB idle
timeout (95 s) is longer.

## First deploy and init (once)

1. Deploy the stack (explicit permission required). The task becomes healthy
   while uninitialized.
2. Create the Doppler project `openbao` with a `dev` config only.
3. Forward the task's API port over SSM (ECS Exec is enabled):

   ```sh
   cluster=<cloudStorageClusterName output of the document-storage dev stack>
   task=$(aws ecs list-tasks --cluster "$cluster" --service-name openbao \
     --query 'taskArns[0]' --output text)
   runtime=$(aws ecs describe-tasks --cluster "$cluster" --tasks "$task" \
     --query "tasks[0].containers[?name=='openbao'].runtimeId | [0]" --output text)
   aws ssm start-session --target "ecs:${cluster}_${task##*/}_${runtime}" \
     --document-name AWS-StartPortForwardingSession \
     --parameters '{"portNumber":["8200"],"localPortNumber":["18200"]}'
   ```

4. In a second shell, initialize with a local `bao` CLI
   (`nix shell nixpkgs#openbao`). The output goes to a private file, never to
   the terminal, and that file is kept until Doppler holds both values. Init
   runs only once, so if any later step fails, keep the file and retry from the
   upload:

   ```sh
   umask 077
   init=$(mktemp)
   bao operator init -address=http://127.0.0.1:18200 \
     -recovery-shares=1 -recovery-threshold=1 -format=json > "$init"
   jq '{OPENBAO_ROOT_TOKEN: .root_token, OPENBAO_RECOVERY_KEY: .recovery_keys_b64[0]}' "$init" \
     | doppler secrets upload -p openbao -c dev /dev/stdin > /dev/null
   cmp -s <(jq -r .root_token "$init") \
          <(doppler secrets get OPENBAO_ROOT_TOKEN -p openbao -c dev --plain) &&
   cmp -s <(jq -r '.recovery_keys_b64[0]' "$init") \
          <(doppler secrets get OPENBAO_RECOVERY_KEY -p openbao -c dev --plain) &&
   shred -u "$init"
   ```

   If `$init` still exists afterwards, the upload or the check failed. Rerun
   the upload and the checks; never rerun `operator init`. With KMS auto-unseal
   the vault unseals itself on every restart. The recovery key is only for
   `bao operator generate-root`.

## Provisioning (follow-up, not in this stack yet)

Hosted provisioning of team namespaces, mounts, JWT roles, and the lifecycle
role is a follow-up that lands after Passwords. Until it does, no team can use
the vault. It will reuse the local bootstrap's policy and role logic and accept
only this exact HTTPS origin. Its JWT roles allow no clock leeway, so DSS and
the vault must keep synchronized clocks (Fargate uses Amazon Time Sync).

At provisioning time, the document storage service's dev Doppler config gets
`OPENBAO_ADDRESS`, `PASSWORDS_JWT_ISSUER`, and `PASSWORDS_JWT_SIGNING_KEY`
together; it refuses a partial set. Only explicitly provisioned teams work,
because creating a team does not create its namespace.

## Backups

The daily AWS Backup job copies files while OpenBao may be writing Raft data, so
a recovery point can be inconsistent. That is acceptable for dev. Before a backup
you depend on (an upgrade, a risky change), stop the task first, then scale back
up:

```sh
aws ecs update-service --cluster "$cluster" --service openbao --desired-count 0
aws backup start-backup-job --backup-vault-name openbao-dev \
  --resource-arn "$(pulumi stack output fileSystemArn --stack macro-inc/dev)" \
  --iam-role-arn "$(pulumi stack output backupRoleArn --stack macro-inc/dev)"
# wait for the job to finish (aws backup describe-backup-job), then:
aws ecs update-service --cluster "$cluster" --service openbao --desired-count 1
```

## Restore

1. Scale the service to 0 (see above).
2. In AWS Backup, restore the recovery point to **this** file system with an
   item-level restore of `/openbao` (or the current `dataDirectory`). AWS Backup
   writes it under a new top-level directory, `/aws-backup-restore_<timestamp>/`,
   and keeps ownership (uid 100).
3. Point the stack at the restored copy and redeploy. Access points are
   immutable, so this replaces the access point:

   ```sh
   pulumi config set dataDirectory /aws-backup-restore_<timestamp>/openbao --stack macro-inc/dev
   pulumi up --stack macro-inc/dev   # explicit permission required
   ```

4. Commit the `Pulumi.dev.yaml` change. The seal key must still exist. The old
   directory stays on the file system until you delete it.

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
