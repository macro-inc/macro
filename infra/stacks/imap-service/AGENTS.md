# IMAP service infrastructure

Internal ECS deployment for `services/imap_service`, with private Cloud Map DNS,
a dedicated credential KMS key, and restricted protocol egress. No public
gateway route exists. Email service calls the authenticated internal API.

## Start here

- `index.ts`: existing VPC/cluster and required dedicated mail subnet IDs.
- `service.ts`: task, private discovery, key policy, security group and alarms.

## Checks

- From `infra/`: `bun run check` and `bunx biome check stacks/imap-service`.

## Gotchas

- Keep `bootstrap_pending` until dedicated NAT/subnets and both Doppler configs exist.
- Set `mail_private_subnet_ids` to approved subnets with dedicated NAT egress; never reuse general application egress silently.
- Doppler supplies `DATABASE_URL`, `INTERNAL_AUTH_KEY` and `IMAP_CREDENTIAL_KMS_KEY_ID`; the latter is `alias/imap-service-<stack>`.
- Match `INTERNAL_AUTH_KEY` to email-service's `InternalApiKey` during bootstrap: both request and notification directions use the same private authentication key.
- KMS context purpose must remain `imap-credentials-v1`, matching the engine cipher.
- Private DNS is `engine.imap-<stack>.macro.internal:8080`; update `macro_service_urls` and the shared URL map together.
- Do not increase `desiredCount` until owner routing is verified across replicas.
- Preparing this stack does not authorize deploying it or provisioning paid networking.
