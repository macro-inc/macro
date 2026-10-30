# Connect dev bootstrap

The shared gateway forwards `/connect` without rewriting the path. `connect_api`
serves its routes under `/connect`, including `/connect/health`; its
`CONNECT_PUBLIC_URL` is `https://dev-gateway.macro.com/connect`.

The `connect-api` Pulumi stack creates a private PostgreSQL 17 instance with a
`connect` database and an RDS-managed `connect_api` password. Pulumi writes its
secret database URL, the grant KMS key id, and the gateway URL to Doppler
`connect-api/dev`. Doppler syncs that config to the ECS `APP_SECRETS_JSON`
secret. No database login or Doppler value needs to be created by hand.

After the reviewed change is on the branch used by the workflows, run these in
order, waiting for each workflow to succeed before starting the next. The human
must add the encrypted stack config to the deploy ref before step 3:

1. Dispatch the shared `doppler-projects` stack. This creates `connect-api`
   with its `dev` config and AWS sync. It targets the **global**
   `doppler-projects/prod` Pulumi stack because Doppler projects are global;
   this does not deploy the Connect API to production.

   ```sh
   gh workflow run deploy-pulumi-stack.yml --ref <reviewed-ref> -f environment=prod -f pulumi-service-name=doppler-projects
   ```

2. Create a Doppler service token with write access to the `connect-api` project
   and its `dev` config. From `infra/stacks/connect-api`, have the human store
   it in the dev stack's encrypted config; this populates
   `Pulumi.dev.yaml`'s `doppler:dopplerToken` key. The equivalent production
   step later uses a token scoped to `connect-api/prd` and populates
   `Pulumi.prod.yaml`. Add the encrypted `Pulumi.dev.yaml` update to the
   reviewed deploy ref. Do not print or commit the plaintext token.

   ```sh
   pulumi config set --stack dev --secret doppler:dopplerToken
   ```

3. Dispatch the Connect infrastructure in dev. This creates RDS and KMS,
   writes the three Doppler values, and installs the gateway rule and ECS
   service in one Pulumi pass.

   ```sh
   gh workflow run deploy-pulumi-stack.yml --ref <reviewed-ref> -f environment=dev -f pulumi-service-name=connect-api
   ```

4. The planner removes `bootstrap_pending` from
   `.github/services-config.json` in a reviewed change after the first
   infrastructure deploy. Once that change is on the deploy ref, dispatch the
   service workflow to build and deploy the Connect binary:

   ```sh
   gh workflow run deploy-service-generic.yml --ref <reviewed-ref-with-gate-removed> -f environment=dev -f service=connect-api
   ```

5. Request `https://dev-gateway.macro.com/connect/health` and expect HTTP 200.
   The service applies its SQLx migrations on startup.

`bootstrap_pending` remains set in this task. Do not run the service workflow
before the planner removes it: the workflow intentionally rejects that state.
