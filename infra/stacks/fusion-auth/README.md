# Macro Fusion Auth

The FusionAuth infrastucture consists of a dedicated `ECS Cluster` to run the FusionAuth service, the `ECS Fargate container` for the FusionAuth service and a postgres database deployed via `RDS`.

## Deployment

To deploy a new stack you'll want to first create a new secret in AWS for the fusionauth database named `fusionauth-db-password-${stack}` where `${stack}` is the stack name.

Once created, you can create a Pulumi.`${stack}.yaml` file with the following contents:

```yaml
config:
  aws-native:region: us-east-1
  aws:region: us-east-1
  fusion-auth:db-password-secret-key: fusionauth-db-password-${stack}
```

Now, you can simply run `pulumi up` with your new stack.
