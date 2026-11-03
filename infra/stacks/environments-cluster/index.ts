import * as aws from '@pulumi/aws';
import * as k8s from '@pulumi/kubernetes';
import * as pulumi from '@pulumi/pulumi';
import { config, stack } from '../../packages/shared';
import { get_coparse_api_vpc } from '../../packages/vpc';

// One EKS cluster for full Macro environments: `cargo x env up <name> --target
// eks` installs `infra/k8s/macro-env` into namespace `macro-<name>`, served at
// `https://<name>.<domain>`. Environments are self-contained (their own
// Postgres, Redis, Kafka, OpenSearch, LocalStack, FusionAuth), so this stack
// touches no shared dev or prod resource.

const name = 'macro-environments';
const tags = {
  environment: stack,
  env: stack,
  project: 'environments-cluster',
  service: 'environments-cluster',
};
const vpc = get_coparse_api_vpc();
const domain = config.require('domain');
const zoneId = config.require('zone_id');
if (domain === 'macro.com' || domain.endsWith('.macro.com')) {
  // Environments run unreviewed branches; keep them off the product's cookie domain.
  throw new Error('domain must be outside macro.com');
}
const nodeInstanceType = config.get('node_instance_type') ?? 'm6i.4xlarge';
const nodeMin = config.getNumber('node_min') ?? 1;
const nodeDesired = config.getNumber('node_desired') ?? 2;
const nodeMax = config.getNumber('node_max') ?? 6;
const kubernetesVersion = config.get('kubernetes_version') ?? '1.33';
// Source ranges allowed to reach the ingress load balancer.
const allowedCidrs = config.getObject<string[]>('allowed_cidrs') ?? [
  '0.0.0.0/0',
];

const assumeBy = (service: string) =>
  aws.iam.getPolicyDocumentOutput({
    statements: [
      {
        actions: ['sts:AssumeRole', 'sts:TagSession'],
        principals: [{ type: 'Service', identifiers: [service] }],
      },
    ],
  }).json;

const clusterRole = new aws.iam.Role(`${name}-cluster-${stack}`, {
  assumeRolePolicy: assumeBy('eks.amazonaws.com'),
  managedPolicyArns: ['arn:aws:iam::aws:policy/AmazonEKSClusterPolicy'],
  tags,
});

const nodeRole = new aws.iam.Role(`${name}-node-${stack}`, {
  assumeRolePolicy: assumeBy('ec2.amazonaws.com'),
  managedPolicyArns: [
    'arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy',
    'arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy',
    'arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly',
  ],
  tags,
});

// Developers reach the cluster by assuming this role (`cargo x env` passes it
// to `aws eks update-kubeconfig`); EKS access entries cannot name IAM groups.
const caller = aws.getCallerIdentityOutput();
const developerRole = new aws.iam.Role(`${name}-developer-${stack}`, {
  name: `${name}-developer-${stack}`,
  assumeRolePolicy: caller.accountId.apply((accountId) =>
    JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: 'sts:AssumeRole',
          Principal: { AWS: `arn:aws:iam::${accountId}:root` },
        },
      ],
    })
  ),
  inlinePolicies: [
    {
      name: 'describe-cluster',
      policy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: ['eks:DescribeCluster'],
            Resource: '*',
          },
        ],
      }),
    },
  ],
  tags,
});

const cluster = new aws.eks.Cluster(`${name}-${stack}`, {
  name,
  version: kubernetesVersion,
  roleArn: clusterRole.arn,
  vpcConfig: {
    subnetIds: [...vpc.privateSubnetIds, ...vpc.publicSubnetIds],
    endpointPublicAccess: true,
    endpointPrivateAccess: true,
  },
  accessConfig: {
    authenticationMode: 'API',
    bootstrapClusterCreatorAdminPermissions: true,
  },
  tags,
});

const developerAccess = new aws.eks.AccessEntry(`${name}-developer-${stack}`, {
  clusterName: cluster.name,
  principalArn: developerRole.arn,
  type: 'STANDARD',
});
new aws.eks.AccessPolicyAssociation(`${name}-developer-admin-${stack}`, {
  clusterName: cluster.name,
  principalArn: developerAccess.principalArn,
  policyArn:
    'arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy',
  accessScope: { type: 'cluster' },
});

const nodes = new aws.eks.NodeGroup(`${name}-nodes-${stack}`, {
  clusterName: cluster.name,
  nodeRoleArn: nodeRole.arn,
  subnetIds: vpc.privateSubnetIds,
  instanceTypes: [nodeInstanceType],
  amiType: 'AL2023_x86_64_STANDARD',
  diskSize: 100,
  scalingConfig: {
    minSize: nodeMin,
    desiredSize: nodeDesired,
    maxSize: nodeMax,
  },
  tags,
});

// Volumes: the EBS CSI driver, authorized through EKS Pod Identity.
const podIdentityAgent = new aws.eks.Addon(
  `${name}-pod-identity-${stack}`,
  {
    clusterName: cluster.name,
    addonName: 'eks-pod-identity-agent',
  },
  { dependsOn: [nodes] }
);
const ebsCsiRole = new aws.iam.Role(`${name}-ebs-csi-${stack}`, {
  assumeRolePolicy: assumeBy('pods.eks.amazonaws.com'),
  managedPolicyArns: [
    'arn:aws:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy',
  ],
  tags,
});
const ebsCsi = new aws.eks.Addon(
  `${name}-ebs-csi-${stack}`,
  {
    clusterName: cluster.name,
    addonName: 'aws-ebs-csi-driver',
    podIdentityAssociations: [
      { roleArn: ebsCsiRole.arn, serviceAccount: 'ebs-csi-controller-sa' },
    ],
  },
  { dependsOn: [podIdentityAgent] }
);

const kubeconfig = pulumi
  .all([cluster.name, cluster.endpoint, cluster.certificateAuthority])
  .apply(([clusterName, endpoint, ca]) =>
    JSON.stringify({
      apiVersion: 'v1',
      kind: 'Config',
      clusters: [
        {
          name: clusterName,
          cluster: { server: endpoint, 'certificate-authority-data': ca.data },
        },
      ],
      contexts: [
        { name: clusterName, context: { cluster: clusterName, user: 'aws' } },
      ],
      'current-context': clusterName,
      users: [
        {
          name: 'aws',
          user: {
            exec: {
              apiVersion: 'client.authentication.k8s.io/v1beta1',
              command: 'aws',
              args: [
                'eks',
                'get-token',
                '--cluster-name',
                clusterName,
                '--region',
                aws.config.region ?? 'us-east-1',
              ],
            },
          },
        },
      ],
    })
  );
const provider = new k8s.Provider(`${name}-k8s-${stack}`, { kubeconfig });

new k8s.storage.v1.StorageClass(
  `${name}-gp3-${stack}`,
  {
    metadata: {
      name: 'gp3',
      annotations: { 'storageclass.kubernetes.io/is-default-class': 'true' },
    },
    provisioner: 'ebs.csi.aws.com',
    parameters: { type: 'gp3' },
    volumeBindingMode: 'WaitForFirstConsumer',
    reclaimPolicy: 'Delete',
    allowVolumeExpansion: true,
  },
  { provider, dependsOn: [ebsCsi] }
);

// TLS terminates on the NLB with a wildcard certificate.
const certificate = new aws.acm.Certificate(`${name}-cert-${stack}`, {
  domainName: `*.${domain}`,
  validationMethod: 'DNS',
  tags,
});
const validationRecords = certificate.domainValidationOptions.apply((options) =>
  options.map(
    (option, i) =>
      new aws.route53.Record(`${name}-cert-validation-${i}-${stack}`, {
        zoneId,
        name: option.resourceRecordName,
        type: option.resourceRecordType,
        records: [option.resourceRecordValue],
        ttl: 60,
        allowOverwrite: true,
      })
  )
);
const validatedCertificate = new aws.acm.CertificateValidation(
  `${name}-cert-validated-${stack}`,
  {
    certificateArn: certificate.arn,
    validationRecordFqdns: validationRecords.apply((records) =>
      records.map((record) => record.fqdn)
    ),
  }
);

// Traefik is the ingress controller on every environment cluster, kind
// included (`cargo x env` installs the same chart version there).
const traefikNamespace = new k8s.core.v1.Namespace(
  `${name}-traefik-ns-${stack}`,
  { metadata: { name: 'traefik' } },
  { provider }
);
const traefik = new k8s.helm.v3.Release(
  `${name}-traefik-${stack}`,
  {
    name: 'traefik',
    chart: 'oci://ghcr.io/traefik/helm/traefik',
    // Keep in step with TRAEFIK_VERSION in xtask_local's k8s/cluster.rs.
    version: '42.3.0',
    namespace: traefikNamespace.metadata.name,
    values: {
      deployment: { replicas: 2 },
      ingressClass: { enabled: true, isDefaultClass: true, name: 'traefik' },
      ports: {
        // The NLB terminates TLS; Traefik serves plain HTTP behind it.
        websecure: {
          http: { tls: { enabled: false } },
          transport: { respondingTimeouts: { readTimeout: 0 } },
        },
      },
      service: {
        spec: { loadBalancerSourceRanges: allowedCidrs },
        annotations: {
          'service.beta.kubernetes.io/aws-load-balancer-type': 'nlb',
          'service.beta.kubernetes.io/aws-load-balancer-scheme':
            'internet-facing',
          'service.beta.kubernetes.io/aws-load-balancer-subnets':
            vpc.publicSubnetIds.join(','),
          'service.beta.kubernetes.io/aws-load-balancer-ssl-cert':
            validatedCertificate.certificateArn,
          'service.beta.kubernetes.io/aws-load-balancer-ssl-ports': '443',
          'service.beta.kubernetes.io/aws-load-balancer-backend-protocol':
            'tcp',
        },
      },
    },
  },
  { provider, dependsOn: [nodes] }
);

const traefikService = k8s.core.v1.Service.get(
  `${name}-traefik-svc-${stack}`,
  pulumi.interpolate`${traefik.status.namespace}/${traefik.status.name}`,
  { provider }
);
const loadBalancerHostname = traefikService.status.loadBalancer.ingress.apply(
  (ingress) => ingress?.[0]?.hostname ?? ''
);

new aws.route53.Record(`${name}-wildcard-${stack}`, {
  zoneId,
  name: `*.${domain}`,
  type: 'CNAME',
  records: [loadBalancerHostname],
  ttl: 60,
});

// One repository; `cargo x env` tags images `<image>-<content digest>`.
const repository = new aws.ecr.Repository(`${name}-images-${stack}`, {
  name: 'macro-env',
  imageTagMutability: 'MUTABLE',
  forceDelete: true,
  tags,
});
new aws.ecr.LifecyclePolicy(`${name}-images-lifecycle-${stack}`, {
  repository: repository.name,
  policy: JSON.stringify({
    rules: [
      {
        rulePriority: 1,
        description: 'Drop images no environment has pushed in two weeks',
        selection: {
          tagStatus: 'any',
          countType: 'sinceImagePushed',
          countUnit: 'days',
          countNumber: 14,
        },
        action: { type: 'expire' },
      },
    ],
  }),
});

export const clusterName = cluster.name;
export const developerRoleArn = developerRole.arn;
export const repositoryUrl = repository.repositoryUrl;
export const ingressHostname = loadBalancerHostname;
export const environmentDomain = domain;
