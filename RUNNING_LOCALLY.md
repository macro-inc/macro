# Running Locally

**DISCLAIMER**: This is a work in progress and we only support running services against dev-assets at this time.

## Prerequisites

- Doppler
- Docker
- AWS


## Setup

- Go into doppler and the `local_services` project. Under the `_personal` environment you will need to update the following variables:

```
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
```

- Next generate your `.env` file via `just get_environment`

## Running

You can run the services via `just build_run_local` or `just run_local` if you have already built the docker images.
