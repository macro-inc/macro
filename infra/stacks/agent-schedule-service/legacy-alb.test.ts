import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Parse source only: importing the stack would perform cloud lookups and builds.
function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(new URL(file, import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
}

const service = parse('./service.ts');
const index = parse('./index.ts');

function nodes<T extends ts.Node>(
  root: ts.Node,
  predicate: (node: ts.Node) => node is T
): T[] {
  const result: T[] = [];
  function visit(node: ts.Node): void {
    if (predicate(node)) result.push(node);
    ts.forEachChild(node, visit);
  }
  visit(root);
  return result;
}

function text(node: ts.Node): string {
  return node.getText().replace(/\s+/g, '');
}

function constructors(
  type: string,
  root: ts.Node = service
): ts.NewExpression[] {
  return nodes(root, ts.isNewExpression).filter(
    (node) => text(node.expression) === type
  );
}

function resource(type: string, root: ts.Node = service): ts.NewExpression {
  const matches = constructors(type, root);
  expect(matches).toHaveLength(1);
  return matches[0];
}

function property(node: ts.Node, key: string): ts.Expression {
  if (!ts.isObjectLiteralExpression(node)) throw new Error('Expected object');
  const member = node.properties.find((entry) => entry.name?.getText() === key);
  if (member && ts.isPropertyAssignment(member)) return member.initializer;
  if (member && ts.isShorthandPropertyAssignment(member)) return member.name;
  throw new Error(`Missing property ${key}`);
}

function shape(node: ts.Node): Record<string, string> {
  if (!ts.isObjectLiteralExpression(node)) throw new Error('Expected object');
  return Object.fromEntries(
    node.properties.map((entry) => {
      const key = entry.name?.getText();
      if (!key) throw new Error('Expected named property');
      return [key, text(property(node, key))];
    })
  );
}

function elements(node: ts.Node): ts.Expression[] {
  if (!ts.isArrayLiteralExpression(node)) throw new Error('Expected array');
  return [...node.elements];
}

function variable(file: ts.SourceFile, name: string): ts.Expression {
  const matches = nodes(file, ts.isVariableDeclaration).filter(
    (node) => text(node.name) === name
  );
  expect(matches).toHaveLength(1);
  if (!matches[0].initializer) throw new Error(`Missing initializer: ${name}`);
  return matches[0].initializer;
}

const ecs = resource('awsx.ecs.FargateService');
const ecsArgs = ecs.arguments![1];
const caller = resource('AgentScheduleService', index);
const container = property(
  property(property(ecsArgs, 'taskDefinitionArgs'), 'containers'),
  'service'
);

test('removes dedicated ALB, DNS, listeners, and legacy security-group surface', () => {
  for (const file of [service, index]) {
    const identifiers = nodes(file, ts.isIdentifier).map((node) => node.text);
    for (const removed of [
      'serviceLoadBalancer',
      'SERVICE_DOMAIN_NAME',
      'serviceAlbSg',
      'isPrivate',
      'publicSubnetIds',
    ]) {
      expect(identifiers).not.toContain(removed);
    }
    for (const type of [
      'aws.lb.LoadBalancer',
      'aws.lb.Listener',
      'aws.lb.ListenerRule',
      'aws.lb.TargetGroup',
      'aws.route53.Record',
      'aws.vpc.SecurityGroupIngressRule',
    ]) {
      expect(constructors(type, file)).toHaveLength(0);
    }
  }
  const fields = nodes(service, ts.isPropertyDeclaration).map((node) =>
    text(node.name)
  );
  for (const field of ['lb', 'listener', 'targetGroup']) {
    expect(fields).not.toContain(field);
  }
});

test('retains scheduled-action gateway identity, paired routes, health and port', () => {
  expect(text(variable(service, 'BASE_NAME'))).toBe('pulumi.getProject()');
  expect(text(variable(service, 'GATEWAY_PATH_PREFIX'))).toBe(
    "'/scheduled-action'"
  );
  const component = nodes(service, ts.isCallExpression).find(
    (node) => node.expression.kind === ts.SyntaxKind.SuperKeyword
  );
  expect(component!.arguments.map(text)).toEqual([
    "'my:components:AgentScheduleService'",
    'name',
    '{}',
    'opts',
  ]);
  expect(text(caller.arguments![0])).toBe('`agent-schedule-service-${stack}`');
  expect(text(ecs.arguments![0])).toBe('`${BASE_NAME}`');
  const gateway = resource('ServiceTargetGroup');
  expect(text(gateway.arguments![0])).toBe('`${stack}-${BASE_NAME}`');
  expect(shape(gateway.arguments![1])).toEqual({
    tags: 'this.tags',
    listenerArn: 'gatewayLoadBalancer.httpsListenerArn',
    vpcId: 'vpc.vpcId',
    containerPort: 'serviceContainerPort',
    service: 'GatewayService.AGENT_SCHEDULE_SERVICE',
    healthCheckPath: 'healthCheckPath',
    pathPatterns: '[GATEWAY_PATH_PREFIX,`${GATEWAY_PATH_PREFIX}/*`]',
    serviceSecurityGroupId: 'this.serviceSg.id',
    albSecurityGroupId: 'gatewayLoadBalancer.albSecurityGroupId',
  });
  expect(shape(gateway.arguments![2])).toEqual({ parent: 'this' });
  expect(text(property(caller.arguments![1], 'serviceContainerPort'))).toBe(
    '8080'
  );
  expect(text(property(caller.arguments![1], 'healthCheckPath'))).toBe(
    "'/health'"
  );
});

test('registers ECS only with the gateway and retains listener dependency', () => {
  expect(elements(property(ecsArgs, 'loadBalancers')).map(shape)).toEqual([
    {
      targetGroupArn: 'gatewayTargetGroup.target_group.arn',
      containerName: "'service'",
      containerPort: 'serviceContainerPort',
    },
  ]);
  expect(elements(property(container, 'portMappings')).map(shape)).toEqual([
    {
      appProtocol: "'http'",
      name: '`${BASE_NAME}-tcp-${stack}`',
      hostPort: 'serviceContainerPort',
      containerPort: 'serviceContainerPort',
      targetGroup: 'gatewayTargetGroup.target_group',
    },
  ]);
  expect(shape(ecs.arguments![2])).toEqual({
    parent: 'this',
    dependsOn: '[gatewayTargetGroup.listener_rule]',
  });
  expect(shape(property(ecsArgs, 'networkConfiguration'))).toEqual({
    subnets: 'vpc.privateSubnetIds',
    securityGroups: '[this.serviceSg.id]',
  });
});

test('preserves the service security group and unrestricted outbound rule', () => {
  const sg = resource('aws.ec2.SecurityGroup');
  expect(text(sg.arguments![0])).toBe('`${BASE_NAME}-sg-${stack}`');
  expect(shape(sg.arguments![1])).toEqual({
    name: '`${BASE_NAME}-sg-${stack}`',
    vpcId: 'vpcId',
    description: '`${BASE_NAME}servicesecuritygroup`',
    tags: 'this.tags',
  });
  expect(shape(sg.arguments![2])).toEqual({ parent: 'this' });
  const egress = resource('aws.vpc.SecurityGroupEgressRule');
  expect(text(egress.arguments![0])).toBe('`${BASE_NAME}-service-out`');
  expect(shape(egress.arguments![1])).toEqual({
    securityGroupId: 'serviceSg.id',
    description: "'Allowalloutboundtraffic'",
    cidrIpv4: "'0.0.0.0/0'",
    ipProtocol: "'-1'",
    tags: 'this.tags',
  });
  expect(shape(egress.arguments![2])).toEqual({ parent: 'this' });
});

test('preserves BASE_URL and Output-shaped dev/prod scheduled-action URL', () => {
  expect(text(variable(service, 'GATEWAY_DOMAIN_NAME'))).toBe(
    "`${stack==='prod'?'gateway':'dev-gateway'}.${BASE_DOMAIN}`"
  );
  const assignments = nodes(service, ts.isBinaryExpression).filter(
    (node) => text(node.left) === 'this.domain'
  );
  expect(assignments).toHaveLength(1);
  expect(text(assignments[0].right)).toBe(
    '`https://${GATEWAY_DOMAIN_NAME}${GATEWAY_PATH_PREFIX}`'
  );
  const baseUrl = elements(property(container, 'environment')).find((node) =>
    ts.isObjectLiteralExpression(node)
  );
  expect(shape(baseUrl!)).toEqual({ name: "'BASE_URL'", value: 'this.domain' });
  expect(text(variable(index, 'agentScheduleServiceUrl'))).toBe(
    'pulumi.interpolate`${service.domain}`'
  );
  expect(text(variable(index, 'agentScheduleServiceRoleArn'))).toBe(
    'service.role.arn'
  );
});

test('preserves CPU-only scaling and capacity/deployment settings', () => {
  const target = resource('aws.appautoscaling.Target');
  expect(text(target.arguments![0])).toBe(
    '`${BASE_NAME}-service-scalable-target-${stack}`'
  );
  expect(shape(target.arguments![1])).toEqual({
    maxCapacity: "stack==='prod'?3:2",
    minCapacity: '1',
    resourceId:
      'pulumi.interpolate`service/${this.cloudStorageClusterName}/${this.service.service.name}`',
    scalableDimension: "'ecs:service:DesiredCount'",
    serviceNamespace: "'ecs'",
    tags: 'this.tags',
  });
  expect(shape(target.arguments![2])).toEqual({ parent: 'this' });
  const policy = resource('aws.appautoscaling.Policy');
  expect(text(policy.arguments![0])).toBe(
    '`${BASE_NAME}-scaling-policy-cpu-${stack}`'
  );
  expect(shape(policy.arguments![1])).toEqual({
    policyType: "'TargetTrackingScaling'",
    resourceId: 'target.resourceId',
    scalableDimension: 'target.scalableDimension',
    serviceNamespace: 'target.serviceNamespace',
    targetTrackingScalingPolicyConfiguration:
      "{targetValue:60,predefinedMetricSpecification:{predefinedMetricType:'ECSServiceAverageCPUUtilization',},scaleInCooldown:60,scaleOutCooldown:120,}",
  });
  expect(shape(policy.arguments![2])).toEqual({ parent: 'this' });
  expect(shape(container)).toMatchObject({
    cpu: '256',
    memory: '512',
    stopTimeout: '10',
  });
  expect(text(property(ecsArgs, 'desiredCount'))).toBe('1');
  expect(text(property(ecsArgs, 'continueBeforeSteadyState'))).toBe(
    'DEFAULT_CONTINUE_BEFORE_STEADY_STATE'
  );
  expect(shape(property(ecsArgs, 'deploymentCircuitBreaker'))).toEqual({
    enable: 'true',
    rollback: 'true',
  });
  expect(
    shape(property(resource('EcrImage').arguments![1], 'buildArgs'))
  ).toEqual({
    SERVICE_NAME: "'service'",
  });
});

test('retains exactly the existing CPU and deployment alarms', () => {
  const alarm = resource('aws.cloudwatch.MetricAlarm');
  expect(text(alarm.arguments![0])).toBe('`${BASE_NAME}-service-cpu-alarm`');
  expect(shape(alarm.arguments![1])).toEqual({
    name: '`${BASE_NAME}-service-cpu-${stack}`',
    alarmDescription: '`Alarmwhen${BASE_NAME}CPUstayselevated`',
    namespace: "'AWS/ECS'",
    metricName: "'CPUUtilization'",
    statistic: "'Average'",
    period: '300',
    evaluationPeriods: '2',
    threshold: '90',
    comparisonOperator: "'GreaterThanOrEqualToThreshold'",
    dimensions:
      '{ClusterName:pulumi.interpolate`${this.cloudStorageClusterName}`,ServiceName:this.service.service.name,}',
    alarmActions: '[CLOUD_TRAIL_SNS_TOPIC_ARN]',
    tags: 'this.tags',
  });
  expect(shape(alarm.arguments![2])).toEqual({ parent: 'this' });
  const deployment = resource('EcsDeploymentFailureAlarm');
  expect(text(deployment.arguments![0])).toBe(
    '`${BASE_NAME}-deployment-failure-alarm`'
  );
  expect(shape(deployment.arguments![1])).toEqual({
    serviceName: 'BASE_NAME',
    serviceArn: 'this.service.service.arn',
    tags: 'this.tags',
  });
  expect(shape(deployment.arguments![2])).toEqual({ parent: 'this' });
});
