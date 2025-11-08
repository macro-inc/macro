# Document Processing Infra

Contains the IaC for the document processing services

## Setting up a new Environment

Initialize the stack:

`pulumi stack init ${STACK_NAME}`

**NOTE** it is required to have `document-storage-service` deployed **first**
under the **same** stack name you chose above.

Select the stack:
`pulumi stack select ${STACK_NAME}`

Initialize aws region values. In `Pulumi.${STACK_NAME}.yaml` add in the
following under the **config** key.

```
  aws-native:region: us-east-1
  aws:region: us-east-1
```

Setup the necessary secrets:
`pulumi config set database_url ${ENVIRONMENTS_DATABASE_URL} --secret`

## Deployment

`pnpm i`

`pulumi preview` - select the stack you wish to deploy

**read** the proposed changes before commiting to the deployment. Mistakes
happen so be cautious to not take down an environment.

`pulumi up` - select the stack you wish to deploy
