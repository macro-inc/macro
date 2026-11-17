# The observability EKS cluster in Ohio. Argo CD syncs main from this path.
{
  nixidy.target = {
    repository = "https://github.com/macro-inc/macro.git";
    branch = "main";
    rootPath = "./infra/k8s/observability/cluster/manifests/prod";
  };

  macro.cluster = {
    name = "observability";
    region = "us-east-2";
    kubernetesVersion = "1.37.0";
    # The Pulumi observability stack tags its VPC with these and no Name.
    vpcTags = {
      project = "observability";
      environment = "prod";
    };
    secretsManagerSecret = "observability/prod";
  };
}
