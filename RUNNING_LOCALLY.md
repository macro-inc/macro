# Running Locally

**DISCLAIMER**: This is a work in progress and we only support running services against dev-assets at this time.

## Prerequisites

- Doppler
- Docker
- AWS


## Setup

- Export the **SOPS_KMS_ARN** (you can skip if you use nix-shell)
`export SOPS_KMS_ARN = "arn:aws:kms:us-east-1:569036502058:key/mrk-cab29bf948044eb79005a81f48d40e93,arn:aws:kms:us-west-1:569036502058:key/mrk-cab29bf948044eb79005a81f48d40e93"`

- Next run `just get_environment` to convert the sops into a .env file
- **NOTE** You'll need to fill in the following variables with your own access key and secret access key

```
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
```

## Running

You can run the services via `just build_run_local` or `just run_local` if you have already built the docker images.
