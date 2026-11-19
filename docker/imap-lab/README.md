# Real IMAP/SMTP test lab

Start isolated Dovecot and Mailpit fixtures from the repository root:

```sh
bash docker/imap-lab/prepare.sh
docker compose -p macro-imap-lab -f docker/imap-lab/compose.yaml up -d
python3 docker/imap-lab/check.py
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
docker/imap-lab/local.env` to `just run_local --no-doppler --instance imap-mail`.
This explicit local profile starts Dovecot on the instance's services network,
relays submission to its Mailpit, and serves the mail rollout flags on an
internal Caddy listener. No other local stack needs to turn on the profile.
Connect your verified sign-in address in Email. For manual settings, use
`maillab.example.net` for both hosts, implicit TLS on 993 and 465, the sign-in
address as both usernames, and the lab password `pass`.
