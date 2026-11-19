# Hosted OpenBao (dev)

Passwords keeps its secret values in OpenBao; Postgres holds only metadata. The
Passwords change adds a local OpenBao to the local stack; this stack is the
hosted dev vault that QA uses.

| Piece | Choice |
| --- | --- |
| Server | Our ECR image `openbao-dev`: `quay.io/openbao/openbao:2.7.2` plus the seal plugin, both digest-pinned (`image/Dockerfile`); one Fargate task on the shared cluster |
| Storage | Integrated Raft, node `macro-dev`, on encrypted EFS through an access point (uid 100, mode 0700); IAM + TLS mount only |
| Seal | `awskms` through the external `kms-aws` plugin (2.7 dropped the built-in), baked into the image and sha256-checked before each launch; key `alias/openbao-dev`, rotation on; only the task role may use it |
| Backup | AWS Backup vault `openbao-dev`, daily at 05:00 UTC, kept 14 days |
| TLS | Internal ALB, ACM certificate for `openbao-dev.macro-internal.com`, TLS 1.2+/1.3 policy |
| Access | ALB ingress 443 only from the document storage service's security group and the OpenBao task's own (the operator tunnel); task port 8200 only from the ALB |
| Audit | Declared device `passwords`, `file_path = stdout`, `log_raw = false`; the `awslogs` driver writes it to the CloudWatch log group `openbao` (30 days), and the shared `datadog-kinesis-stream` Firehose forwards it to Datadog as `service:openbao` |
| Network | Private subnets of the shared VPC; task egress is NFS to its EFS and HTTPS to AWS APIs only in practice, but the rule is still `0.0.0.0/0` (see "Network") |
| Alarms | ECS deployment failure; no healthy target for 5 minutes |

The server's `default_max_request_duration` (90 s) matches local; the ALB idle
timeout (95 s) is longer.

## Image

`image/Dockerfile` builds on the digest-pinned upstream image and copies the
`kms-aws` binary out of its digest-pinned plugin image, so the server downloads
nothing at startup. Pulumi builds it (`linux/amd64`) and pushes it to the
`openbao-dev` ECR repository on deploy. To upgrade OpenBao or the plugin,
change both digests in the Dockerfile and `KMS_AWS_PLUGIN_SHA256` in
`server-config.ts`, from the same openbao/openbao-plugins release's
checksummed `linux_amd64` asset. A wrong checksum leaves the vault sealed, and
the deployment circuit breaker rolls back. The plugin the server used to download is still
in `plugins/` beside the Raft `data/` on EFS; nothing reads it, and it can be
deleted.

## Logs

Server and audit logs (JSON) go to the CloudWatch log group `openbao`, and the
shared Firehose forwards them to Datadog. Datadog's Firehose docs name a
non-Lambda log group's source and service after the group, so they arrive as
`service:openbao`; no other non-Lambda group uses this stream yet, so after the
first deploy confirm with `@aws.awslogs.logGroup:openbao`. The Firehose adds no
`env` tag. The task runs no Datadog agent or Grafana Alloy sidecar:
there is no live container CPU/memory view in Datadog (CloudWatch ECS metrics
remain, and the alarms below use CloudWatch), no copy of the logs in dev
Grafana, and no traces (OpenBao never sent any). OpenBao telemetry was never
configured.

## Network

The task runs in the shared VPC's private subnets, whose route tables send
`0.0.0.0/0` to a NAT, and that VPC has no AWS interface endpoints. At runtime
the task reaches only AWS APIs: ECR and S3 for the image pull, CloudWatch Logs,
KMS for the seal, and `ssmmessages` for ECS Exec. The HTTPS egress rule is still
`0.0.0.0/0`, because private-DNS interface endpoints in the shared VPC would
reroute every dev and prod service there. Moving OpenBao into its own VPC with
no NAT or internet gateway removes that rule.

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

## Operator tunnel

Operators reach the verified HTTPS origin through an SSM port-forward that runs
inside the OpenBao task and connects to the internal ALB. The ALB admits the
task's security group for exactly this. TLS is still checked against
`openbao-dev.macro-internal.com`, so the client knows it is talking to this
vault:

```sh
target=<ecs:<cluster>_<task id>_<openbao container runtime id>, as in step 3 above>
aws ssm start-session --target "$target" \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters '{"host":["openbao-dev.macro-internal.com"],"portNumber":["443"],"localPortNumber":["18443"]}'
# in another shell:
curl --connect-to openbao-dev.macro-internal.com:443:127.0.0.1:18443 \
  https://openbao-dev.macro-internal.com/v1/sys/health
```

Only the TCP endpoint moves to the local port. The origin stays exactly
`https://openbao-dev.macro-internal.com`, with no port, in both the Host header
and the TLS name, so you don't need to bind local port 443. Hosted provisioning
connects the same way, through its `--connect 127.0.0.1:18443` option. Use the
tunnel for provisioning and any other administration. The plain
port-forward to 8200 in step 3 is only for the one-time init.

## Provisioning

`infra/openbao/provision.py` provisions a team's namespace, mounts, policies,
and JWT roles through the operator tunnel, with the same logic as the local
bootstrap; [its README](../../openbao/README.md) has the procedure. Only
explicitly provisioned teams work, because creating a team does not create its
namespace: each new team needs its own run. Its JWT roles allow no clock
leeway, so DSS and the vault must keep synchronized clocks (Fargate uses Amazon
Time Sync).

The document storage service's dev Doppler config holds `OPENBAO_ADDRESS`,
`PASSWORDS_JWT_ISSUER`, and `PASSWORDS_JWT_SIGNING_KEY` together; it refuses a
partial set.

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
- **Key rotation:** roles that trust the old and new signing keys together
  (`jwt_validation_pubkeys` takes a list), so rotation needs no outage.
- **Service URL:** `OPENBAO_ADDRESS` becomes a typed `macro_service_urls` entry.
- **Monitoring:** telemetry to Grafana/Datadog; seal, leader, and Raft-commit
  alerts; audit logs retained in immutable storage.
