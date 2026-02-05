# FusionAuth Instance Stack

This pulumi stack contains everything you need to be able to setup a "macro compliant" fusionauth instance.

Supports easy setup for local development.

# Prerequisites

The following are required tools you need to have setup ahead of time:

`docker` and `docker-compose`
`pulumi`
`aws-cli`
`just`

# Usage
**Important** do not use `macro-inc/` prefix when you make your fusionauth-instance local stack. This is meant to be stored on __your__ pulumi account only (local to you) not on the organization.

## Deploy Local Fusionauth Instance

Make sure you've already created your main **.env** file in the root of the repo via `just get_environment`.

Run `just setup` to setup the local fusionauth instance and get everything ready to be run.

Important Keys:

```
username: admin@macro.com
password: macroIsGreat!
api-key: bf69486b-4733-4954-a44e-2e1b5f2c8a91
```

# TODO
- [ ] configure idps
- [ ] sync prod with pulumi stack
