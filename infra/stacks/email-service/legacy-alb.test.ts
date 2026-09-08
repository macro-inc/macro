import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Parse source only: importing a stack would run cloud lookups and image builds.
function readSource(path: string): ts.SourceFile {
  return ts.createSourceFile(
    path,
    readFileSync(new URL(path, import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
}

const service = readSource('./service.ts');
const index = readSource('./index.ts');
const urls = readSource('../../packages/shared/src/service_urls.ts');

function nodes<T extends ts.Node>(
  root: ts.Node,
  predicate: (node: ts.Node) => node is T
): T[] {
  const matches: T[] = [];
  function visit(node: ts.Node): void {
    if (predicate(node)) matches.push(node);
    ts.forEachChild(node, visit);
  }
  visit(root);
  return matches;
}

function only<T>(matches: T[]): T {
  expect(matches).toHaveLength(1);
  return matches[0];
}

function resource(
  root: ts.Node,
  constructorName: string,
  name?: string
): ts.NewExpression {
  return only(
    nodes(root, ts.isNewExpression).filter(
      (node) =>
        node.expression.getText() === constructorName &&
        (name === undefined || node.arguments?.[0].getText() === name)
    )
  );
}

function property(root: ts.Node, name: string): ts.Expression {
  if (!ts.isObjectLiteralExpression(root)) {
    throw new Error(`Expected object for ${name}: ${root.getText()}`);
  }
  const member = only(
    root.properties.filter((node) => node.name?.getText() === name)
  );
  if (ts.isPropertyAssignment(member)) return member.initializer;
  if (ts.isShorthandPropertyAssignment(member)) return member.name;
  throw new Error(`Expected property assignment: ${member.getText()}`);
}

function variable(root: ts.Node, name: string): ts.Expression {
  const declaration = only(
    nodes(root, ts.isVariableDeclaration).filter(
      (node) => node.name.getText() === name
    )
  );
  if (!declaration.initializer) throw new Error(`Missing initializer: ${name}`);
  return declaration.initializer;
}

function assignment(name: string): string {
  return only(
    nodes(service, ts.isBinaryExpression).filter(
      (node) =>
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        node.left.getText() === name
    )
  ).right.getText();
}

type Shape = string | Shape[] | { [key: string]: Shape };

function shape(node: ts.Node): Shape {
  if (ts.isObjectLiteralExpression(node)) {
    return Object.fromEntries(
      node.properties.map((member) => {
        if (!member.name) throw new Error('Unexpected spread');
        return [
          member.name.getText(),
          shape(property(node, member.name.getText())),
        ];
      })
    );
  }
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(shape);
  return node.getText();
}

const ecs = resource(service, 'awsx.ecs.FargateService');
const gateway = resource(service, 'ServiceTargetGroup');

test('removes dedicated ALB, DNS, security groups and obsolete arguments', () => {
  const identifiers = nodes(service, ts.isIdentifier).map((node) => node.text);
  for (const removed of [
    'serviceLoadBalancer',
    'SERVICE_DOMAIN_NAME',
    'BASE_DOMAIN',
    'serviceAlbSg',
    'listener',
    'isPrivate',
    'publicSubnetIds',
    'route53',
  ]) {
    expect(identifiers).not.toContain(removed);
  }
  expect(
    nodes(service, ts.isPropertyDeclaration).map((node) => node.name.getText())
  ).not.toContain('lb');
  expect(
    nodes(service, ts.isPropertyAccessExpression).map((node) => node.getText())
  ).not.toContain('this.lb');
  const constructors = nodes(service, ts.isNewExpression).map((node) =>
    node.expression.getText()
  );
  for (const removed of [
    'aws.lb.LoadBalancer',
    'aws.lb.Listener',
    'aws.lb.ListenerRule',
    'aws.lb.TargetGroup',
    'aws.route53.Record',
    'aws.vpc.SecurityGroupIngressRule',
  ]) {
    expect(constructors).not.toContain(removed);
  }
  expect(nodes(index, ts.isIdentifier).map((node) => node.text)).not.toContain(
    'isPrivate'
  );
  expect(index.text).not.toContain('serviceAlbSg');
});

test('preserves gateway identity, routing, health checks and security wiring', () => {
  expect(variable(service, 'BASE_NAME').getText()).toBe("'email-service'");
  expect(variable(service, 'gatewayLoadBalancer').getText()).toBe(
    'getGatewayAlb()'
  );
  expect(gateway.arguments?.[0].getText()).toBe('`${stack}-${BASE_NAME}`');
  expect(shape(gateway.arguments![1])).toEqual({
    tags: 'this.tags',
    listenerArn: 'gatewayLoadBalancer.httpsListenerArn',
    vpcId: 'vpc.vpcId',
    containerPort: 'serviceContainerPort',
    service: 'GatewayService.EMAIL_SERVICE',
    healthCheckPath: 'healthCheckPath',
    pathPatterns: ["'/email'", "'/email/*'"],
    serviceSecurityGroupId: 'this.serviceSg.id',
    albSecurityGroupId: 'gatewayLoadBalancer.albSecurityGroupId',
  });
  expect(shape(gateway.arguments![2])).toEqual({ parent: 'this' });
  const api = resource(index, 'EmailService');
  expect(api.arguments?.[0].getText()).toBe("'email-service'");
  expect(property(api.arguments![1], 'serviceContainerPort').getText()).toBe(
    '8080'
  );
  expect(property(api.arguments![1], 'healthCheckPath').getText()).toBe(
    "'/health'"
  );

  const sg = resource(service, 'aws.ec2.SecurityGroup');
  expect(sg.arguments?.[0].getText()).toBe('`${BASE_NAME}-sg-${stack}`');
  expect(shape(sg.arguments![1])).toEqual({
    name: '`${BASE_NAME}-sg-${stack}`',
    vpcId: 'vpcId',
    description:
      '`${BASE_NAME} security group that is attached directly to the service`',
    tags: 'this.tags',
  });
  expect(shape(sg.arguments![2])).toEqual({ parent: 'this' });
  const egress = resource(service, 'aws.vpc.SecurityGroupEgressRule');
  expect(egress.arguments?.[0].getText()).toBe('`${BASE_NAME}-all-out`');
  expect(shape(egress.arguments![1])).toEqual({
    securityGroupId: 'serviceSg.id',
    description: "'Allow all outbound'",
    cidrIpv4: "'0.0.0.0/0'",
    ipProtocol: "'-1'",
    tags: 'this.tags',
  });
  expect(shape(egress.arguments![2])).toEqual({ parent: 'this' });
  expect(shape(property(ecs.arguments![1], 'networkConfiguration'))).toEqual({
    subnets: 'vpc.privateSubnetIds',
    securityGroups: ['this.serviceSg.id'],
  });
});

test('registers ECS and its port mapping only with the existing gateway target', () => {
  expect(assignment('this.targetGroup')).toBe(
    'gatewayTargetGroup.target_group'
  );
  expect(ecs.arguments?.[0].getText()).toBe('`${BASE_NAME}`');
  expect(shape(property(ecs.arguments![1], 'loadBalancers'))).toEqual([
    {
      targetGroupArn: 'gatewayTargetGroup.target_group.arn',
      containerName: "'service'",
      containerPort: 'serviceContainerPort',
    },
  ]);
  const task = property(ecs.arguments![1], 'taskDefinitionArgs');
  const container = property(property(task, 'containers'), 'service');
  expect(shape(property(container, 'portMappings'))).toEqual([
    {
      appProtocol: "'http'",
      name: '`${BASE_NAME}-tcp-${stack}`',
      hostPort: 'serviceContainerPort',
      containerPort: 'serviceContainerPort',
      targetGroup: 'this.targetGroup',
    },
  ]);
  expect(shape(ecs.arguments![2])).toEqual({
    parent: 'this',
    dependsOn: ['gatewayTargetGroup.listener_rule'],
  });
});

test('exports the gateway email URL as a Pulumi Output in dev and prod', () => {
  expect(assignment('this.domain')).toBe(
    'getServiceUrl(ServiceUrl.EMAIL_SERVICE_URL)'
  );
  expect(variable(index, 'emailServiceUrl').getText()).toBe(
    'pulumi.interpolate`${emailService.domain}`'
  );
  for (const [map, url] of [
    ['DEV_SERVICE_URLS', 'https://dev-gateway.macro.com/email'],
    ['PROD_SERVICE_URLS', 'https://gateway.macro.com/email'],
  ]) {
    expect(
      property(variable(urls, map), '[ServiceUrl.EMAIL_SERVICE_URL]').getText()
    ).toBe(`'${url}'`);
  }
});

test('preserves gateway request autoscaling', () => {
  expect(variable(service, 'resourceLabel').getText()).toBe(
    'pulumi.interpolate`${gatewayAlbArnSuffix}/${gatewayTargetGroup.arnSuffix}`'
  );
  const setup = only(
    nodes(service, ts.isCallExpression).filter(
      (node) => node.expression.getText() === 'this.setupAutoScaling'
    )
  );
  expect(shape(setup.arguments[0])).toEqual({
    gatewayAlbArnSuffix: 'gatewayLoadBalancer.albArnSuffix',
    gatewayTargetGroup: 'gatewayTargetGroup.target_group',
  });
  const policy = resource(
    service,
    'aws.appautoscaling.Policy',
    '`${BASE_NAME}-scaling-policy-request-count-${stack}`'
  );
  expect(
    shape(
      property(policy.arguments![1], 'targetTrackingScalingPolicyConfiguration')
    )
  ).toEqual({
    targetValue: '1000',
    predefinedMetricSpecification: {
      predefinedMetricType: "'ALBRequestCountPerTarget'",
      resourceLabel: 'resourceLabel',
    },
    scaleInCooldown: '60',
    scaleOutCooldown: '120',
  });
});

test('scopes the existing 5xx alarm to email targets without changing alarm policy', () => {
  const alarm = resource(
    service,
    'aws.cloudwatch.MetricAlarm',
    '`${BASE_NAME}-http-5xx-alarm`'
  );
  expect(shape(alarm.arguments![1])).toEqual({
    name: '`${BASE_NAME}-http-5xx-${stack}`',
    metricName: "'HTTPCode_Target_5XX_Count'",
    namespace: "'AWS/ApplicationELB'",
    statistic: "'Sum'",
    period: '180',
    evaluationPeriods: '1',
    threshold: '25',
    comparisonOperator: "'GreaterThanOrEqualToThreshold'",
    dimensions: {
      LoadBalancer: 'gatewayLoadBalancer.albArnSuffix',
      TargetGroup: 'this.targetGroup.arnSuffix',
    },
    alarmDescription:
      '`High HTTP 5XX count alarm for ${BASE_NAME} gateway target group.`',
    actionsEnabled: 'true',
    alarmActions: ['CLOUD_TRAIL_SNS_TOPIC_ARN'],
    tags: 'this.tags',
  });
  expect(shape(alarm.arguments![2])).toEqual({ parent: 'this' });
});
