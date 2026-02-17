# Running Locally

**DISCLAIMER**: This is a work in progress and we only support running services against dev-assets at this time.

## Prerequisites

- Doppler
- Docker
- AWS
- SQLX

## Local Setup

### Setup SOPS
Export the **SOPS_KMS_ARN** (you can skip if you use nix-shell)

```bash
export SOPS_KMS_ARN = "arn:aws:kms:us-east-1:569036502058:key/mrk-cab29bf948044eb79005a81f48d40e93,arn:aws:kms:us-west-1:569036502058:key/mrk-cab29bf948044eb79005a81f48d40e93"
```

You can run `just get_environment` to convert the encrypted sops file into a 
.env file. **Importantly**, if you modify the .env file then rerun 
`just get_environment` it will **wipe** any changes you made to the file.

You can also run `just get_environment dev` to get all environment variables 
needed to run locally against dev assets. You will need to fill in the AWS 
credentials.

### Setup Localstack
You need to initialize the localstack with all local AWS constructs.

To do this run the following:

```bash
just setup_localstack
```

### Setup Local MacroDB
To instantiate macrodb run `just setup_local_dbs`.

### Setup FusionAuth
To setup local FusionAuth run `just infra/stacks/fusionauth-instance/setup`. 
Make sure you have already generated your .env file as FusionAuth needs to 
append values to it.

### Building the base docker image
We have a single "root" docker image that is used as a base for all services.
To build this you can run `just rust/cloud-storage/build_dev_service_images`

## Running

You can run the services via `just run_local` or `just build_run_local` if you wanted to rebuild the base docker image.

If you've updated the docker image after making changes to a service you'll need
to provide the `--build` flag in `just run_local` to trigger docker-compose to
update the containers.

By default we don't run **convert_service** or **search_processing_service**
locally as they are not needed by the frontend when using dev assets. 
