# Real IMAP/SMTP test lab

Start isolated Dovecot, Mailpit and the local KMS fixture from the repository root:

```sh
bash docker/imap-lab/start.sh
```

The check verifies certificate trust and hostname checks, separate mailboxes
for two accounts, APPEND, flag updates, MOVE, and authenticated submission over
both implicit TLS and STARTTLS. It then verifies both messages reached Mailpit.
It validates the lab; the Rust engine's integration suite exercises Macro.

Each username authenticates with `pass` and receives its own mail home. The
fixtures contain no external credentials. TLS is required for authentication.
The generated CA and keys are ignored, expire after 30 days, and are used only
by this lab. Remove the generated directory to issue a new local certificate.

| Listener | Host port | Container port |
| --- | --- | --- |
| IMAP implicit TLS | 35993 | 31993 |
| IMAP STARTTLS | 35143 | 31143 |
| SMTP implicit TLS | 35465 | 31465 |
| SMTP STARTTLS | 35587 | 31587 |
| Mailpit HTTP | 35825 | 8025 |
| LocalStack KMS | 35456 | 4566 |

All host listeners bind loopback. Set the `IMAP_LAB_*_PORT` Compose variables
and matching check arguments when another lab occupies these ports. SMTP
submission passes through Dovecot authentication to Mailpit, which captures
mail without external delivery. The server certificate covers
`maillab.example.net` and `localhost`; the engine's local endpoint mapping
must retain the requested hostname for TLS verification.

Stop this task's lab without deleting its mail:

```sh
docker compose -p macro-imap-lab -f docker/imap-lab/compose.yaml stop
```

### Macro browser and local sign-in

Run `bash docker/imap-lab/prepare.sh` and supply `--env-file
docker/imap-lab/browser-profile` to `just run_local --no-doppler --instance imap-mail`.
This explicit local profile starts Dovecot on the instance's services network,
relays submission to a dedicated Mailpit, and serves the mail rollout flags on an
internal Caddy listener. The ordinary application Mailpit retains its authentication
settings for sign-up mail. No other local stack needs to turn on the profile.
Connect your verified sign-in address in Email. For manual settings, use
`maillab.example.net` for both hosts, implicit TLS on 993 and 465, the sign-in
address as both usernames, and the lab password `pass`.

Run `just imap-e2e-browser` to exercise this setup with desktop and phone
Chromium. The test signs into Macro, connects its mailbox, reads a message
inserted through IMAP, and confirms that its reply arrived in Mailpit.

### Second server and API test infrastructure

`python3 docker/imap-lab/stalwart.py` configures the optional pinned Stalwart
server with the same trusted CA, two synthetic accounts and no external mail
delivery configuration. See [the lab guide](AGENTS.md#second-server) for ports
and credentials. The setup is safe to rerun against its existing fixture data.

For task-owned SQS and Kafka listeners, start
`docker compose -p macro-imap-lab -f docker/imap-lab/compose.yaml --profile e2e up -d sqs kafka`.
Use `EMAIL_E2E_SQS_URL=http://127.0.0.1:37924` and
`EMAIL_E2E_KAFKA_BROKERS=127.0.0.1:37992` with the Rust email E2E harness.
Each scenario leases its own database, Redis database and queues.

With an owner-only shell umask, FusionAuth may report that its mounted
kickstart file is missing. For this no-Doppler browser fixture, keep the
instance directory `infra/local/generated/imap-mail` at mode 0700. Its
`kickstart` subdirectory must be traversable and its JSON readable by the
container's UID 1001. Modes 0755 and 0644 on those two entries preserve host
isolation behind the private instance directory. Restart only the instance's
FusionAuth container after correcting those two modes. The fixture database
and volumes are preserved.
