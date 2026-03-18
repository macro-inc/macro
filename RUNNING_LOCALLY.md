# Running Locally

**DISCLAIMER**: This is a work in progress and we only support running services against dev-assets at this time.

## Prerequisites

- sops
- Docker
- AWS
- SQLX
- Pulumi
- Bun
- Node
- sqlx-cli

## Local Setup

Export the **SOPS_KMS_ARN** (you can skip if you use nix-shell)

```bash
export SOPS_KMS_ARN = "arn:aws:kms:us-east-1:569036502058:key/mrk-cab29bf948044eb79005a81f48d40e93,arn:aws:kms:us-west-1:569036502058:key/mrk-cab29bf948044eb79005a81f48d40e93"
```

Run `just setup` to initialize your entire environment.

## Running

### Backend

You can run the services via `just run_local`.

If you've updated the docker image after making changes to a service you'll need
to provide the `--build` flag in `just run_local` to trigger docker-compose to
update the containers.

By default we don't run **convert_service** or **search_processing_service**
locally as they are not needed by the frontend when using dev assets. 

### Frontend

You can run the following command to get the frontend running pointed to local 
services `cd js/app && bun i && just local`.
