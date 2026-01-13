# FusionAuth Instance Stack

This pulumi stack contains everything you need to be able to setup a "macro compliant" fusionauth instance.

Ideal for local development.

# Prerequisites

The following are required tools you need to have setup ahead of time:

`docker` and `docker-compose`
`pulumi`
`aws-cli`

# Usage
**Important** do not use `macro-inc/` prefix when you make your fusionauth-instance local stack. This is meant to be stored on __your__ pulumi account only (local to you) not on the organization.

## Deploy Local Fusionauth Instance

Download your .env file used to create the local fusionauth stack:

```bash
curl -o .env https://raw.githubusercontent.com/FusionAuth/fusionauth-containers/452efcac5c60f6a3a734947b1a8eefaae6f811fa/docker/fusionauth/.env
```

This is used in the docker-compose automatically.

Now run `docker-compose up` to create the local fusionauth instance.
Through the [./kickstart/kickstart.json](kickstart) file, we automatically create an admin user and admin api key to use.

```
username: admin@macro.com
password: macroIsGreat!
api-key: bf69486b-4733-4954-a44e-2e1b5f2c8a91
```

You now need to update the .env with a few extra values that are needed by pulumi:

```bash
echo "FUSION_AUTH_HOST_URL=http://localhost:9011" >> .env
echo "FUSION_AUTH_API_KEY=bf69486b-4733-4954-a44e-2e1b5f2c8a91" >> .env
```

We store these in .env and not in the pulumi config so we don't need to worry about storing these safely for non-local deployments.
 
```bash
pulumi up --stack local
```

# TODO
- [ ] configure google IDP
- [ ] configure google_gmail IDP
- [ ] export necessary items so you can easily update your local .env with fusionauth values
- [ ] figure out strategy for having this work for dev/prod
