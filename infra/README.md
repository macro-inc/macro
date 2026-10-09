# Macro Cloud Infra

This monorepo contains the code for all Macro Cloud IaC.

## IaC
Infrastructure is written with [pulumi](https://www.pulumi.com/docs/) with typescript and bun.

We use AWS for all infrastructure so ask to be added to the aws org and setup [pulumi with aws](https://www.pulumi.com/registry/packages/aws/installation-configuration/). Production infrastructure is in `us-east-1`; the [observability pilot](stacks/observability/README.md) runs independently in `us-east-2`.

The stacks directory represents the infrastructure for each service and pulumi should be run from inside a stack directory. From `stacks/my-service/` run `pulumi up --stack [dev | prod]` to deploy. 

We use datadog (on `us-central-1`) for logging. 
