# Running Locally

**DISCLAIMER**: This is a work in progress and we only support running services against dev-assets at this time.

## Prerequisites

- Doppler
- Docker
- AWS
- SQLX

## Setup

- You need to initialize the local postgres db with schema/data. To do this 
run:

```bash
just run_dbs
just init_local_dbs
```

- Export the **SOPS_KMS_ARN** (you can skip if you use nix-shell)
`export SOPS_KMS_ARN = "arn:aws:kms:us-east-1:569036502058:key/mrk-cab29bf948044eb79005a81f48d40e93,arn:aws:kms:us-west-1:569036502058:key/mrk-cab29bf948044eb79005a81f48d40e93"`

- Next run `just get_environment` to convert the sops into a .env file
    - By default this will get you a fully local environment. If you want to 
    run against dev assets you can run `just get_environment dev`. You'll need
    to update the AWS access key with a valid one if you do this though.

- Run `just setup_localstack` to instantiate all the local aws assets

## Running

You can run the services via `just build_run_local` or `just run_local` if you 
have already built the docker images.

If you've updated the docker image after making changes to a service you'll need
to provide the `--build` flag in `just run_local` to trigger docker-compose to
update the containers.

By default we don't run **convert_service** or **search_processing_service**
locally as they are not needed by the frontend when using dev assets. 
