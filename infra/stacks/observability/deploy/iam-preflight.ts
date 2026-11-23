// Before Pulumi deletes the old host, prove the deploy credentials may make
// every call the replacement needs. A missing permission otherwise surfaces
// only after the old instance is gone. IAM's policy simulator evaluates the
// caller's real policies against the stack's real resource ARNs.
import { ACCOUNT, REGION, aws } from './aws';

export interface StackResources {
  instanceArn: string;
  instanceId: string;
  subnetId: string;
  securityGroupIds: string[];
  availabilityZone: string;
  volumeArn: string;
  hostRoleArn: string;
  targetGroupArns: string[];
  alarmArns: string[];
}

interface ExportedResource {
  type: string;
  urn: string;
  outputs?: Record<string, unknown>;
}

function only(resources: ExportedResource[], type: string, name: string) {
  const match = resources.filter(
    (resource) => resource.type === type && resource.urn.endsWith(`::${name}`)
  );
  if (match.length !== 1 || !match[0].outputs) {
    throw new Error(`Expected one ${type} named ${name} in the stack`);
  }
  return match[0].outputs;
}

/** The identifiers a replacement touches, from `pulumi stack export`. */
export function stackResources(state: {
  deployment: { resources?: ExportedResource[] };
}): StackResources {
  const resources = state.deployment.resources ?? [];
  const instance = only(
    resources,
    'aws:ec2/instance:Instance',
    'observability'
  );
  const volume = only(resources, 'aws:ebs/volume:Volume', 'observability-data');
  const role = only(resources, 'aws:iam/role:Role', 'observability-host');
  const arns = (type: string) =>
    resources
      .filter((resource) => resource.type === type)
      .map((resource) => String(resource.outputs?.arn));
  return {
    instanceArn: String(instance.arn),
    instanceId: String(instance.id),
    subnetId: String(instance.subnetId),
    securityGroupIds: instance.vpcSecurityGroupIds as string[],
    availabilityZone: String(instance.availabilityZone),
    volumeArn: String(volume.arn),
    hostRoleArn: String(role.arn),
    targetGroupArns: arns('aws:lb/targetGroup:TargetGroup'),
    alarmArns: arns('aws:cloudwatch/metricAlarm:MetricAlarm'),
  };
}

export interface Check {
  action: string;
  resources: string[];
  context?: Record<string, string>;
}

const OBSERVABILITY = { 'aws:ResourceTag/project': 'observability' };

/** Every call Pulumi makes to replace the instance, in the order it makes them. */
export function replacementChecks(stack: StackResources, ami: string): Check[] {
  const ec2 = (resource: string) =>
    `arn:aws:ec2:${REGION}:${ACCOUNT}:${resource}`;
  return [
    { action: 'ec2:DescribeInstances', resources: ['*'] },
    { action: 'ec2:DescribeInstanceAttribute', resources: ['*'] },
    { action: 'ec2:DescribeVolumes', resources: ['*'] },
    { action: 'ec2:DescribeImages', resources: ['*'] },
    { action: 'route53:ListHostedZones', resources: ['*'] },
    // Detach the data volume with the old host stopped, as the attachment requires.
    {
      action: 'elasticloadbalancing:DeregisterTargets',
      resources: stack.targetGroupArns,
    },
    {
      action: 'ec2:StopInstances',
      resources: [stack.instanceArn],
      context: OBSERVABILITY,
    },
    {
      action: 'ec2:DetachVolume',
      resources: [stack.instanceArn, stack.volumeArn],
      context: OBSERVABILITY,
    },
    {
      action: 'ec2:TerminateInstances',
      resources: [stack.instanceArn],
      context: OBSERVABILITY,
    },
    {
      action: 'ec2:RunInstances',
      resources: [ec2('instance/*')],
      context: { 'aws:RequestTag/project': 'observability' },
    },
    {
      action: 'ec2:RunInstances',
      resources: [
        `arn:aws:ec2:${REGION}::image/${ami}`,
        ec2(`subnet/${stack.subnetId}`),
        ...stack.securityGroupIds.map((id) => ec2(`security-group/${id}`)),
        ec2('network-interface/*'),
        ec2('volume/*'),
      ],
      context: OBSERVABILITY,
    },
    {
      action: 'ec2:CreateTags',
      resources: [ec2('instance/*')],
      context: { 'ec2:CreateAction': 'RunInstances' },
    },
    {
      action: 'iam:PassRole',
      resources: [stack.hostRoleArn],
      context: { 'iam:PassedToService': 'ec2.amazonaws.com' },
    },
    {
      action: 'ec2:AttachVolume',
      resources: [ec2('instance/*'), stack.volumeArn],
      context: OBSERVABILITY,
    },
    {
      action: 'elasticloadbalancing:RegisterTargets',
      resources: stack.targetGroupArns,
    },
    { action: 'elasticloadbalancing:DescribeTargetHealth', resources: ['*'] },
    { action: 'cloudwatch:PutMetricAlarm', resources: stack.alarmArns },
    { action: 'cloudwatch:DescribeAlarms', resources: ['*'] },
    { action: 'cloudwatch:ListTagsForResource', resources: stack.alarmArns },
  ];
}

/** The IAM principal behind the caller: a user as is, an assumed-role session as its role. */
export function principalArnOf(callerArn: string): string {
  if (/^arn:aws:iam::\d{12}:user\/.+$/.test(callerArn)) return callerArn;
  const match = /^arn:aws:sts::(\d{12}):assumed-role\/([^/]+)\/.+$/.exec(
    callerArn
  );
  if (!match) throw new Error(`Cannot simulate the policy of ${callerArn}`);
  return `arn:aws:iam::${match[1]}:role/${match[2]}`;
}

interface Evaluation {
  EvalActionName: string;
  EvalResourceName: string;
  EvalDecision: string;
}

/** Returns the denied `action on resource` pairs; empty means the replacement can complete. */
export function simulate(checks: Check[]): string[] {
  const caller = aws<{ Arn: string }>(REGION, 'sts', 'get-caller-identity').Arn;
  const principal = principalArnOf(caller);
  const denied: string[] = [];
  for (const check of checks) {
    const context = Object.entries({
      'aws:RequestedRegion': REGION,
      ...check.context,
    }).map(
      ([key, value]) =>
        `ContextKeyName=${key},ContextKeyValues=${value},ContextKeyType=string`
    );
    const results = aws<{ EvaluationResults: Evaluation[] }>(
      'us-east-1',
      'iam',
      'simulate-principal-policy',
      '--policy-source-arn',
      principal,
      '--action-names',
      check.action,
      '--resource-arns',
      ...check.resources,
      '--context-entries',
      ...context
    ).EvaluationResults;
    for (const result of results) {
      if (result.EvalDecision !== 'allowed') {
        denied.push(`${result.EvalActionName} on ${result.EvalResourceName}`);
      }
    }
  }
  return denied;
}
