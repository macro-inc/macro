import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function source(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(new URL(file, import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );
}

const service = source('service.ts');
const index = source('index.ts');
const printer = ts.createPrinter({ removeComments: true });

function text(node: ts.Node): string {
  return printer.printNode(ts.EmitHint.Unspecified, node, node.getSourceFile());
}

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

function only<T>(items: T[]): T {
  expect(items).toHaveLength(1);
  return items[0];
}

function construction(
  root: ts.Node,
  type: string,
  name?: string
): ts.NewExpression {
  return only(
    nodes(root, ts.isNewExpression).filter(
      (node) =>
        text(node.expression) === type &&
        (name === undefined || text(node.arguments![0]) === name)
    )
  );
}

function property(node: ts.Node, name: string): ts.Expression {
  if (!ts.isObjectLiteralExpression(node)) {
    throw new Error(`Expected object: ${text(node)}`);
  }
  const member = only(
    node.properties.filter((entry) => entry.name?.getText() === name)
  );
  if (ts.isPropertyAssignment(member)) return member.initializer;
  if (ts.isShorthandPropertyAssignment(member)) return member.name;
  throw new Error(`Expected property: ${name}`);
}

function elements(node: ts.Node): ts.NodeArray<ts.Expression> {
  if (!ts.isArrayLiteralExpression(node)) {
    throw new Error(`Expected array: ${text(node)}`);
  }
  return node.elements;
}

function properties(node: ts.Node, expected: Record<string, string>): void {
  for (const [name, value] of Object.entries(expected)) {
    expect(text(property(node, name))).toBe(value);
  }
}

function variable(root: ts.Node, name: string): ts.Expression {
  return only(
    nodes(root, ts.isVariableDeclaration).filter(
      (node) => text(node.name) === name
    )
  ).initializer!;
}

const ecs = construction(service, 'awsx.ecs.FargateService');
const ecsArgs = ecs.arguments![1];
const container = property(
  property(property(ecsArgs, 'taskDefinitionArgs'), 'containers'),
  'service'
);

test('removes dedicated ALB, DNS, security group, and obsolete arguments', () => {
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
    const constructors = nodes(file, ts.isNewExpression).map((node) =>
      text(node.expression)
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
    expect(file.text).not.toContain('aws.route53');
  }
  const fields = nodes(service, ts.isPropertyDeclaration).map((node) =>
    text(node.name)
  );
  expect(fields).not.toContain('lb');
  expect(fields).not.toContain('listener');
});

test('preserves gateway identity, routing, health checks, and service security', () => {
  const gateway = construction(service, 'ServiceTargetGroup');
  expect(text(gateway.arguments![0])).toBe('`${stack}-${BASE_NAME}`');
  properties(gateway.arguments![1], {
    listenerArn: 'gatewayLoadBalancer.httpsListenerArn',
    vpcId: 'vpc.vpcId',
    containerPort: 'serviceContainerPort',
    service: 'GatewayService.CONTACTS_SERVICE',
    healthCheckPath: 'healthCheckPath',
    pathPatterns: "['/contacts', '/contacts/*']",
    serviceSecurityGroupId: 'this.serviceSg.id',
    albSecurityGroupId: 'gatewayLoadBalancer.albSecurityGroupId',
    tags: 'this.tags',
  });
  expect(text(gateway.arguments![1])).not.toContain('priority:');
  properties(gateway.arguments![2], { parent: 'this' });
  const caller = construction(index, 'ContactsService');
  expect(text(caller.arguments![0])).toBe("'contacts-service'");
  properties(caller.arguments![1], {
    serviceContainerPort: '8080',
    healthCheckPath: "'/health'",
    contactsQueueArn: 'contactsQueueArn',
  });
  const superCall = only(
    nodes(service, ts.isCallExpression).filter(
      (node) => node.expression.kind === ts.SyntaxKind.SuperKeyword
    )
  );
  expect(text(superCall.arguments[0])).toBe(
    "'my:components:CloudStorageService'"
  );
  const sg = construction(service, 'aws.ec2.SecurityGroup');
  expect(text(sg.arguments![0])).toBe('`${BASE_NAME}-sg-${stack}`');
  properties(sg.arguments![1], {
    name: '`${BASE_NAME}-sg-${stack}`',
    vpcId: 'vpcId',
    tags: 'this.tags',
  });
  properties(sg.arguments![2], { parent: 'this' });
  const outbound = construction(service, 'aws.vpc.SecurityGroupEgressRule');
  expect(text(outbound.arguments![0])).toBe('`${BASE_NAME}-all-out`');
  properties(outbound.arguments![1], {
    securityGroupId: 'serviceSg.id',
    cidrIpv4: "'0.0.0.0/0'",
    ipProtocol: "'-1'",
    tags: 'this.tags',
  });
  properties(outbound.arguments![2], { parent: 'this' });
  properties(property(ecsArgs, 'networkConfiguration'), {
    securityGroups: '[this.serviceSg.id]',
    subnets: 'vpc.privateSubnetIds',
  });
});

test('registers ECS only with the gateway and retains listener dependency', () => {
  const assignment = only(
    nodes(service, ts.isBinaryExpression).filter(
      (node) => text(node.left) === 'this.targetGroup'
    )
  );
  expect(text(assignment.right)).toBe('gatewayTargetGroup.target_group');
  expect(text(ecs.arguments![0])).toBe('`${BASE_NAME}`');
  properties(only([...elements(property(ecsArgs, 'loadBalancers'))]), {
    targetGroupArn: 'gatewayTargetGroup.target_group.arn',
    containerName: "'service'",
    containerPort: 'serviceContainerPort',
  });
  properties(only([...elements(property(container, 'portMappings'))]), {
    appProtocol: "'http'",
    name: '`${BASE_NAME}-tcp-${stack}`',
    hostPort: 'serviceContainerPort',
    containerPort: 'serviceContainerPort',
    targetGroup: 'this.targetGroup',
  });
  properties(ecs.arguments![2], {
    parent: 'this',
    dependsOn: '[gatewayTargetGroup.listener_rule]',
  });
});

test('BASE_URL and exported URL agree for prod and non-prod; queues stay stable', () => {
  const domain = only(
    nodes(service, ts.isBinaryExpression).filter(
      (node) => text(node.left) === 'this.domain'
    )
  ).right;
  const exportedUrl = variable(index, 'contactsServiceUrl');
  for (const stack of ['prod', 'dev', 'staging']) {
    const context = { stack, BASE_DOMAIN: 'macro.com' };
    const expected = `https://${stack === 'prod' ? '' : `${stack}-`}gateway.macro.com/contacts`;
    // Evaluate only the isolated URL expressions, never the Pulumi modules.
    expect(runInNewContext(text(domain), context)).toBe(expected);
    expect(runInNewContext(text(exportedUrl), context)).toBe(expected);
  }
  const baseUrl = only(
    elements(property(container, 'environment')).filter(
      (node) =>
        ts.isObjectLiteralExpression(node) &&
        text(property(node, 'name')) === "'BASE_URL'"
    )
  );
  properties(baseUrl, { value: 'this.domain' });
  expect(text(construction(index, 'Queue').arguments![0])).toBe("'contacts'");
  expect(text(variable(index, 'contactsQueueArn'))).toBe(
    'contactsQueue.queue.arn'
  );
  expect(text(variable(index, 'contactsQueueName'))).toBe(
    'contactsQueue.queue.name'
  );
});

test('preserves gateway request scaling and CPU/memory policy settings', () => {
  expect(text(variable(service, 'resourceLabel'))).toBe(
    'pulumi.interpolate `${gatewayAlbArnSuffix}/${gatewayTargetGroup.arnSuffix}`'
  );
  const setup = only(
    nodes(service, ts.isCallExpression).filter(
      (node) => text(node.expression) === 'this.setupAutoScaling'
    )
  );
  properties(setup.arguments[0], {
    gatewayAlbArnSuffix: 'gatewayLoadBalancer.albArnSuffix',
    gatewayTargetGroup: 'gatewayTargetGroup.target_group',
  });
  for (const [suffix, metric, target, scaleIn, scaleOut] of [
    ['request-count', 'ALBRequestCountPerTarget', '1000', '60', '120'],
    ['cpu', 'ECSServiceAverageCPUUtilization', '70.0', '100', '300'],
    ['memory', 'ECSServiceAverageMemoryUtilization', '70.0', '100', '300'],
  ]) {
    const policy = construction(
      service,
      'aws.appautoscaling.Policy',
      `\`\${BASE_NAME}-scaling-policy-${suffix}-\${stack}\``
    );
    const tracking = property(
      policy.arguments![1],
      'targetTrackingScalingPolicyConfiguration'
    );
    properties(tracking, {
      targetValue: target,
      scaleInCooldown: scaleIn,
      scaleOutCooldown: scaleOut,
    });
    properties(property(tracking, 'predefinedMetricSpecification'), {
      predefinedMetricType: `'${metric}'`,
      ...(suffix === 'request-count' ? { resourceLabel: 'resourceLabel' } : {}),
    });
  }
});

test('scopes the existing 5xx alarm to gateway target errors without policy changes', () => {
  const alarm = construction(
    service,
    'aws.cloudwatch.MetricAlarm',
    '`${BASE_NAME}-http-5xx-alarm`'
  );
  properties(alarm.arguments![1], {
    name: '`${BASE_NAME}-http-5xx-${stack}`',
    metricName: "'HTTPCode_Target_5XX_Count'",
    namespace: "'AWS/ApplicationELB'",
    statistic: "'Sum'",
    period: '180',
    evaluationPeriods: '1',
    threshold: '25',
    comparisonOperator: "'GreaterThanOrEqualToThreshold'",
    actionsEnabled: 'true',
    alarmActions: '[CLOUD_TRAIL_SNS_TOPIC_ARN]',
    tags: 'this.tags',
    alarmDescription:
      '`High HTTP 5XX count alarm for ${BASE_NAME} gateway target group.`',
  });
  const dimensions = property(alarm.arguments![1], 'dimensions');
  properties(dimensions, {
    LoadBalancer: 'gatewayLoadBalancer.albArnSuffix',
    TargetGroup: 'this.targetGroup.arnSuffix',
  });
  expect((dimensions as ts.ObjectLiteralExpression).properties).toHaveLength(2);
  expect(text(alarm.arguments![1])).not.toContain('treatMissingData');
  properties(alarm.arguments![2], { parent: 'this' });
});
