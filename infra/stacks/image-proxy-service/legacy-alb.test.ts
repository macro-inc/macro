import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Parse source only: importing a stack would run Pulumi lookups and image builds.
function parse(relativePath: string): ts.SourceFile {
  return ts.createSourceFile(
    relativePath,
    readFileSync(new URL(relativePath, import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
}

const service = parse('./image-proxy-service.ts');
const index = parse('./index.ts');

function nodes<T extends ts.Node>(
  root: ts.Node,
  guard: (node: ts.Node) => node is T
): T[] {
  const matches: T[] = [];
  function visit(node: ts.Node): void {
    if (guard(node)) matches.push(node);
    ts.forEachChild(node, visit);
  }
  visit(root);
  return matches;
}

function resource(
  source: ts.SourceFile,
  constructorName: string,
  name?: string
): ts.NewExpression {
  const matches = nodes(source, ts.isNewExpression).filter(
    (node) =>
      node.expression.getText() === constructorName &&
      (name === undefined || node.arguments?.[0].getText() === name)
  );
  expect(matches).toHaveLength(1);
  return matches[0];
}

function variable(source: ts.SourceFile, name: string): ts.Expression {
  const matches = nodes(source, ts.isVariableDeclaration).filter(
    (node) => node.name.getText() === name
  );
  expect(matches).toHaveLength(1);
  const initializer = matches[0].initializer;
  if (!initializer) throw new Error(`Missing initializer for ${name}`);
  return initializer;
}

function property(node: ts.Node, ...path: string[]): ts.Node {
  let current = node;
  for (const key of path) {
    if (!ts.isObjectLiteralExpression(current)) {
      throw new Error(`Expected object for ${key}`);
    }
    const member = current.properties.find(
      (entry) => entry.name?.getText() === key
    );
    if (!member) throw new Error(`Missing property ${key}`);
    if (ts.isPropertyAssignment(member)) current = member.initializer;
    else if (ts.isShorthandPropertyAssignment(member)) current = member.name;
    else throw new Error(`Unsupported property ${key}`);
  }
  return current;
}

type Shape = string | Shape[] | { [key: string]: Shape };

function shape(node: ts.Node): Shape {
  if (ts.isObjectLiteralExpression(node)) {
    return Object.fromEntries(
      node.properties.map((member) => {
        const key = member.name?.getText();
        if (!key) throw new Error('Expected named property');
        return [key, shape(property(node, key))];
      })
    );
  }
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(shape);
  return node.getText();
}

describe('image proxy shared gateway migration', () => {
  test('removes dedicated load balancing, DNS, and obsolete API fields', () => {
    const identifiers = [service, index].flatMap((source) =>
      nodes(source, ts.isIdentifier).map((node) => node.text)
    );
    for (const removed of [
      'serviceLoadBalancer',
      'SERVICE_DOMAIN_NAME',
      'serviceAlbSg',
      'imageProxyServiceAlbSgId',
      'isPrivate',
      'publicSubnetIds',
      'domain',
      'listener',
    ]) {
      expect(identifiers).not.toContain(removed);
    }
    expect(
      nodes(service, ts.isPropertyDeclaration).map((node) =>
        node.name.getText()
      )
    ).not.toContain('lb');
    expect(
      nodes(service, ts.isIdentifier).map((node) => node.text)
    ).not.toContain('BASE_DOMAIN');
    const constructors = nodes(service, ts.isNewExpression).map((node) =>
      node.expression.getText()
    );
    expect(constructors).not.toContain('MacroApplicationLoadBalancer');
    expect(
      constructors.some((name) => /^aws\.(lb|alb|route53)\./.test(name))
    ).toBe(false);
  });

  test('preserves gateway identity, routes, health check, and security pairing', () => {
    const gateway = resource(service, 'ServiceTargetGroup');
    expect(gateway.arguments?.[0].getText()).toBe('`${stack}-${BASE_NAME}`');
    expect(shape(gateway.arguments![1])).toEqual({
      tags: 'this.tags',
      listenerArn: 'gatewayLoadBalancer.httpsListenerArn',
      vpcId: 'vpc.vpcId',
      containerPort: 'serviceContainerPort',
      service: 'GatewayService.IMAGE_PROXY_SERVICE',
      healthCheckPath: 'healthCheckPath',
      pathPatterns: ["'/image-proxy'", "'/image-proxy/*'"],
      serviceSecurityGroupId: 'this.serviceSg.id',
      albSecurityGroupId: 'gatewayLoadBalancer.albSecurityGroupId',
    });
    expect(shape(gateway.arguments![2])).toEqual({ parent: 'this' });
    const caller = resource(index, 'ImageProxyService');
    expect(
      property(caller.arguments![1], 'serviceContainerPort').getText()
    ).toBe('8080');
    expect(property(caller.arguments![1], 'healthCheckPath').getText()).toBe(
      "'/health'"
    );
    const assignments = nodes(service, ts.isBinaryExpression).filter(
      (node) => node.left.getText() === 'this.targetGroup'
    );
    expect(assignments).toHaveLength(1);
    expect(assignments[0].right.getText()).toBe(
      'gatewayTargetGroup.target_group'
    );
  });

  test('registers ECS only with the gateway and retains its listener dependency', () => {
    const ecs = resource(service, 'awsx.ecs.FargateService');
    expect(ecs.arguments![0].getText()).toBe('`${BASE_NAME}`');
    expect(shape(property(ecs.arguments![1], 'loadBalancers'))).toEqual([
      {
        targetGroupArn: 'gatewayTargetGroup.target_group.arn',
        containerName: "'service'",
        containerPort: 'serviceContainerPort',
      },
    ]);
    const container = property(
      ecs.arguments![1],
      'taskDefinitionArgs',
      'containers',
      'service'
    );
    expect(shape(property(container, 'portMappings'))).toEqual([
      {
        appProtocol: "'http'",
        name: '`${BASE_NAME}-tcp-${stack}`',
        hostPort: 'serviceContainerPort',
        containerPort: 'serviceContainerPort',
        targetGroup: 'this.targetGroup',
      },
    ]);
    for (const [key, value] of [
      ['cpu', '512'],
      ['memory', '1024'],
      ['stopTimeout', '10'],
    ]) {
      expect(property(container, key).getText()).toBe(value);
    }
    expect(property(ecs.arguments![1], 'desiredCount').getText()).toBe('1');
    expect(shape(ecs.arguments![2])).toEqual({
      parent: 'this',
      dependsOn: ['gatewayTargetGroup.listener_rule'],
    });
    expect(shape(property(ecs.arguments![1], 'networkConfiguration'))).toEqual({
      subnets: 'vpc.privateSubnetIds',
      securityGroups: ['this.serviceSg.id'],
    });
  });

  test('retains only the service security group and unrestricted outbound rule', () => {
    const sg = resource(service, 'aws.ec2.SecurityGroup');
    expect(sg.arguments![0].getText()).toBe('`${BASE_NAME}-sg-${stack}`');
    expect(shape(sg.arguments![1])).toEqual({
      name: '`${BASE_NAME}-sg-${stack}`',
      vpcId: 'vpcId',
      description:
        '`${BASE_NAME} security group that is attached directly to the service`',
      tags: 'this.tags',
    });
    expect(shape(sg.arguments![2])).toEqual({ parent: 'this' });
    const egress = resource(service, 'aws.vpc.SecurityGroupEgressRule');
    expect(egress.arguments![0].getText()).toBe('`${BASE_NAME}-all-out`');
    expect(shape(egress.arguments![1])).toEqual({
      securityGroupId: 'serviceSg.id',
      description: "'Allow all outbound'",
      cidrIpv4: "'0.0.0.0/0'",
      ipProtocol: "'-1'",
      tags: 'this.tags',
    });
    expect(shape(egress.arguments![2])).toEqual({ parent: 'this' });
    expect(
      nodes(service, ts.isNewExpression).filter(
        (node) =>
          node.expression.getText() === 'aws.vpc.SecurityGroupIngressRule'
      )
    ).toHaveLength(0);
  });

  test('retains the dev/prod gateway URL expression and service SG export', () => {
    expect(variable(index, 'imageProxyServiceSgId').getText()).toBe(
      'imageProxyService.serviceSg.id'
    );
    expect(variable(index, 'imageProxyServiceUrl').getText()).toBe(
      "`https://${\n  stack === 'prod' ? '' : `${stack}-`\n}gateway.${BASE_DOMAIN}/image-proxy`"
    );
  });

  test('uses gateway ARN suffixes for request scaling without retuning policies', () => {
    const calls = nodes(service, ts.isCallExpression).filter(
      (node) => node.expression.getText() === 'this.setupAutoScaling'
    );
    expect(calls).toHaveLength(1);
    expect(shape(calls[0].arguments[0])).toEqual({
      gatewayAlbArnSuffix: 'gatewayLoadBalancer.albArnSuffix',
      gatewayTargetGroup: 'gatewayTargetGroup.target_group',
    });
    expect(variable(service, 'resourceLabel').getText()).toBe(
      'pulumi.interpolate`${gatewayAlbArnSuffix}/${gatewayTargetGroup.arnSuffix}`'
    );
    const target = resource(service, 'aws.appautoscaling.Target');
    expect(target.arguments![0].getText()).toBe(
      '`${BASE_NAME}-service-scalable-target-${stack}`'
    );
    expect(shape(target.arguments![1])).toEqual({
      maxCapacity: "stack === 'prod' ? 15 : 3",
      minCapacity: '1',
      resourceId:
        'pulumi.interpolate`service/${this.cloudStorageClusterName}/${this.service.service.name}`',
      scalableDimension: "'ecs:service:DesiredCount'",
      serviceNamespace: "'ecs'",
      tags: 'this.tags',
    });
    for (const [suffix, metric, value, scaleIn, scaleOut] of [
      ['request-count', 'ALBRequestCountPerTarget', '1000', '60', '120'],
      ['cpu', 'ECSServiceAverageCPUUtilization', '70.0', '100', '300'],
      ['memory', 'ECSServiceAverageMemoryUtilization', '70.0', '100', '300'],
    ]) {
      const policy = resource(
        service,
        'aws.appautoscaling.Policy',
        `\`\${BASE_NAME}-scaling-policy-${suffix}-\${stack}\``
      );
      expect(shape(policy.arguments![1])).toEqual({
        policyType: "'TargetTrackingScaling'",
        resourceId: 'serviceScalableTarget.resourceId',
        scalableDimension: 'serviceScalableTarget.scalableDimension',
        serviceNamespace: 'serviceScalableTarget.serviceNamespace',
        targetTrackingScalingPolicyConfiguration: {
          targetValue: value,
          predefinedMetricSpecification: {
            predefinedMetricType: `'${metric}'`,
            ...(suffix === 'request-count'
              ? { resourceLabel: 'resourceLabel' }
              : {}),
          },
          scaleInCooldown: scaleIn,
          scaleOutCooldown: scaleOut,
        },
      });
      expect(shape(policy.arguments![2])).toEqual({ parent: 'this' });
    }
  });

  test('scopes the existing 5xx alarm to image proxy targets without policy changes', () => {
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

  test('retains JWT secret permissions and their role attachment', () => {
    const policy = resource(
      service,
      'aws.iam.Policy',
      '`${BASE_NAME}-secrets-policy`'
    );
    expect(shape(policy.arguments![1])).toEqual({
      policy: {
        Version: "'2012-10-17'",
        Statement: [
          {
            Action: ["'secretsmanager:GetSecretValue'"],
            Resource: ['...secretKeyArns'],
            Effect: "'Allow'",
          },
        ],
      },
      tags: 'this.tags',
    });
    const attachment = resource(service, 'aws.iam.RolePolicyAttachment');
    expect(attachment.arguments![0].getText()).toBe(
      '`${BASE_NAME}-secrets-policy-attachment`'
    );
    expect(shape(attachment.arguments![1])).toEqual({
      role: 'this.role.name',
      policyArn: 'secretsPolicy.arn',
    });
    expect(shape(variable(index, 'secretKeyArns'))).toEqual([
      'pulumi.interpolate`${jwtSecretKeyArn}`',
      'pulumi.interpolate`${MACRO_API_TOKENS.macroApiTokenPublicKeyArn}`',
    ]);
  });

  test('keeps the implicit 15-second gateway drain and 3600-second idle timeout', () => {
    const gatewayTarget = resource(service, 'ServiceTargetGroup');
    expect(shape(gatewayTarget.arguments![1])).not.toHaveProperty(
      'deregistrationDelay'
    );
    const sharedTarget = resource(
      parse('../../packages/resources/src/resources/service_target_group.ts'),
      'aws.lb.TargetGroup'
    );
    expect(
      property(sharedTarget.arguments![1], 'deregistrationDelay').getText()
    ).toBe('args.deregistrationDelay ?? DEFAULT_DEREGISTRATION_DELAY_SECONDS');
    expect(
      variable(
        parse(
          '../../packages/resources/src/resources/ecs_deployment_defaults.ts'
        ),
        'DEFAULT_DEREGISTRATION_DELAY_SECONDS'
      ).getText()
    ).toBe('15');
    const gateway = resource(
      parse('../gateway/index.ts'),
      'MacroApplicationLoadBalancer'
    );
    expect(property(gateway.arguments![1], 'idleTimeout').getText()).toBe(
      '3600'
    );
  });
});
