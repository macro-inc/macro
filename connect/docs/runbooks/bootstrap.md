# Standalone Connect bootstrap

Connect runs at `https://connect-dev.macro.com` on its own ALB and ECS cluster.
The service serves `/health`, `/v1/catalog`, and all other routes at the host
root. It applies its own SQLx migrations at startup. Nothing in Macro's
gateway, deploy pipeline, or shared security groups is changed.

## Local

From the repository root, start PostgreSQL 17 and the API, then create a
customer with a localhost redirect origin:

```sh
docker compose -f connect/docker-compose.yml up -d --build db api && docker compose -f connect/docker-compose.yml run --rm api create-customer local --redirect-origin http://localhost:3000
```

The CLI prints the customer key once. Store it locally; do not put it in a
repository file. Check `curl http://localhost:8080/health` and
`curl http://localhost:8080/v1/catalog`. The Compose wrapping key and database
password are fixed development values; do not use this stack for real grants.
Stop it with `docker compose -f connect/docker-compose.yml down`.
If port 8080 is in use, set `CONNECT_PORT` for both Compose commands and use
that port in the health and catalog URLs.

## Dev AWS stack

Prerequisites: `PULUMI_ACCESS_TOKEN`, AWS credentials for the target account,
Docker, Bun, and Pulumi. The AWS identity must be allowed to read the existing
VPC and manage the standalone resources and DNS in Route 53 zone
`Z0766278GIHB3CVV9CIL`. The human supplies the existing VPC id and public
and private subnet ids; Connect creates its own security groups.

From `connect/infra`, install dependencies and select `dev`:

```sh
bun install --frozen-lockfile
pulumi stack select dev --create
pulumi config set vpcId <existing-vpc-id>
pulumi config set --path 'publicSubnetIds[0]' <public-subnet-id-1>
pulumi config set --path 'publicSubnetIds[1]' <public-subnet-id-2>
pulumi config set --path 'privateSubnetIds[0]' <private-subnet-id-1>
pulumi config set --path 'privateSubnetIds[1]' <private-subnet-id-2>
```

Add more subnet ids if needed. For each live `own_app` entry, the human sets
its credentials in encrypted config; no own-app credentials are required for
the current live catalog:

```sh
pulumi config set --secret --path 'ownAppCredentials.<app-id>.clientId' <client-id>
pulumi config set --secret --path 'ownAppCredentials.<app-id>.clientSecret' <client-secret>
```

The human reviews and approves each of these commands separately:

```sh
pulumi preview --stack dev
pulumi up --stack dev
```

Pulumi builds the API image from the repository root, creates the database
with an RDS-managed password, and writes `APP_SECRETS_JSON` to its own Secrets
Manager secret for ECS injection. Connect reads no runtime Doppler project.
After the deploy succeeds, check:

```sh
curl --fail https://connect-dev.macro.com/health
curl --fail https://connect-dev.macro.com/v1/catalog
```

The `prod` stack uses PostgreSQL 17 on `db.t4g.small`, 14-day backups, RDS
deletion protection, and Pulumi protection. Its public hostname is deliberately
unset until the product owner chooses it; set `publicHost` before previewing
production.

## Demo

For a local demo, create a separate customer with a localhost redirect origin.
The CLI prints its key once; pass it to Compose from the process environment:

```sh
docker compose -f connect/docker-compose.yml run --rm api create-customer demo --redirect-origin http://localhost:3000
CONNECT_DEMO_CUSTOMER_KEY=<local-demo-key> docker compose -f connect/docker-compose.yml up -d --build demo
curl --fail http://localhost:3000/demo/health
```

For dev, create another demo customer with redirect origin
`https://connect-dev.macro.com` (the origin, without `/demo`). Run
`connect_api create-customer demo --redirect-origin
https://connect-dev.macro.com` against the dev database using the approved
operations path. Store its key with `pulumi config set --secret demoCustomerKey
<dev-demo-key>` in `connect/infra`, then review the Pulumi preview and deploy
with human approval. Setting the encrypted key creates the demo image, service,
secret, and `/demo` listener rule; leaving it unset creates none of them.
After deployment, open `https://connect-dev.macro.com/demo`. The demo uses its
own customer key and keeps browser identities in secure cookies.

## Verify

Run the live integration checks against dev with a customer key whose redirect
origins include `http://localhost:3000`:

```sh
CONNECT_IT_CUSTOMER_KEY=<customer-key> nix develop --command connect/tooling/integration.sh dev
```

The runner follows each live app's authorization URL and checks that the vendor
accepts the request up to the consent or sign-in page. It does not complete
consent. For the local Compose stack, run
`nix develop --command connect/tooling/integration.sh local`; the script creates
a temporary customer and stops its own Compose project afterward.
