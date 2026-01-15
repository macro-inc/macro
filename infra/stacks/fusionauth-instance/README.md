# FusionAuth Instance Stack

This pulumi stack contains everything you need to be able to setup a "macro compliant" fusionauth instance.

Ideal for local development.

# Prerequisites

The following are required tools you need to have setup ahead of time:

`docker` and `docker-compose`
`pulumi`
`aws-cli`
`just`

# Usage
**Important** do not use `macro-inc/` prefix when you make your fusionauth-instance local stack. This is meant to be stored on __your__ pulumi account only (local to you) not on the organization.

## Deploy Local Fusionauth Instance

Download your .env file used to create the local fusionauth stack:

```bash
just setup_fusionauth_env
```

This is used in the docker-compose automatically.

Now run `just start_fusionauth` to create the local fusionauth instance. Through the [./kickstart/kickstart.json](kickstart) file, we automatically create an admin user and admin api key to use.

```
username: admin@macro.com
password: macroIsGreat!
api-key: bf69486b-4733-4954-a44e-2e1b5f2c8a91
```

Now you can run the following to get things in sync and ready to start your local dev journey
 
```bash
just instantiate_fusionauth
```

# TODO
- [ ] configure idps
- [ ] sync prod with pulumi stack
