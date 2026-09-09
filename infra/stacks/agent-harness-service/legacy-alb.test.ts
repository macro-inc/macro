import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import {
  GATEWAY_PRIORITIES,
  GatewayService,
} from '../../packages/shared/src/gateway_priorities';

// Inspect declarations without running stack lookups, secrets, or image builds.
function parse(path: string): ts.SourceFile {
  return ts.createSourceFile(
    path,
    readFileSync(new URL(path, import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
}

const service = parse('./agent_harness_service.ts');
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

function property(node: ts.Node, ...path: string[]): ts.Node {
  let current = node;
  for (const key of path) {
    if (!ts.isObjectLiteralExpression(current))
      throw new Error('Expected object');
    const member = current.properties.find(
      (entry) => entry.name?.getText() === key
    );
    if (!member) throw new Error(`Missing ${key}`);
    if (ts.isPropertyAssignment(member)) current = member.initializer;
    else if (ts.isShorthandPropertyAssignment(member)) current = member.name;
    else throw new Error(`Unsupported ${key}`);
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

function assignment(name: string): string {
  const matches = nodes(service, ts.isBinaryExpression).filter(
    (node) => node.left.getText() === name
  );
  expect(matches).toHaveLength(1);
  return matches[0].right.getText();
}

function variable(source: ts.SourceFile, name: string): ts.Expression {
  const matches = nodes(source, ts.isVariableDeclaration).filter(
    (node) => node.name.getText() === name
  );
  expect(matches).toHaveLength(1);
  const value = matches[0].initializer;
  if (!value) throw new Error(`Missing initializer for ${name}`);
  return value;
}

describe('agent-harness shared gateway migration', () => {
  test('removes the dedicated ALB, both DNS records, and obsolete component fields', () => {
    const identifiers = [service, index].flatMap((source) =>
      nodes(source, ts.isIdentifier).map((node) => node.text)
    );
    for (const removed of [
      'serviceLoadBalancer',
      'MacroApplicationLoadBalancer',
      'SERVICE_DOMAIN_NAME',
      'EGRESS_DOMAIN_NAME',
      'BASE_DOMAIN',
      'hostHeaders',
      'serviceAlbSg',
      'isPrivate',
      'publicSubnetIds',
      'listener',
    ])
      expect(identifiers).not.toContain(removed);
    expect(
      nodes(service, ts.isPropertyDeclaration).map((node) =>
        node.name.getText()
      )
    ).not.toContain('lb');
    expect(
      nodes(service, ts.isNewExpression).some((node) =>
        /^aws\.(lb|alb|route53)\./.test(node.expression.getText())
      )
    ).toBe(false);
  });

  test('preserves the existing control target identity, paths, and security group pairing', () => {
    const control = resource(
      service,
      'ServiceTargetGroup',
      '`${stack}-${BASE_NAME}`'
    );
    expect(shape(control.arguments![1])).toEqual({
      tags: 'this.tags',
      listenerArn: 'gatewayLoadBalancer.httpsListenerArn',
      vpcId: 'vpc.vpcId',
      containerPort: 'serviceContainerPort',
      service: 'GatewayService.AGENT_HARNESS_SERVICE',
      healthCheckPath: 'healthCheckPath',
      pathPatterns: ["'/agent-harness'", "'/agent-harness/*'"],
      serviceSecurityGroupId: 'serviceSg.id',
      albSecurityGroupId: 'gatewayLoadBalancer.albSecurityGroupId',
    });
    expect(shape(control.arguments![2])).toEqual({ parent: 'this' });
    expect(assignment('this.targetGroup')).toBe(
      'gatewayTargetGroup.target_group'
    );
    expect(GATEWAY_PRIORITIES[GatewayService.AGENT_HARNESS_SERVICE]).toBe(70);
  });

  test('routes the egress prefix to a new gateway target with a unique priority', () => {
    const egress = resource(
      service,
      'ServiceTargetGroup',
      '`ah-egress-gateway-${stack}`'
    );
    expect(shape(egress.arguments![1])).toEqual({
      listenerArn: 'gatewayLoadBalancer.httpsListenerArn',
      vpcId: 'vpc.vpcId',
      containerPort: 'egressContainerPort',
      healthCheckPath: 'healthCheckPath',
      pathPatterns: ["'/agent-harness-egress'", "'/agent-harness-egress/*'"],
      service: 'GatewayService.AGENT_HARNESS_EGRESS',
      serviceSecurityGroupId: 'serviceSg.id',
      albSecurityGroupId: 'gatewayLoadBalancer.albSecurityGroupId',
      tags: 'tags',
    });
    expect(shape(egress.arguments![2])).toEqual({ parent: 'this' });
    expect(assignment('this.egressTargetGroup')).toBe('egress.target_group');
    expect(GATEWAY_PRIORITIES[GatewayService.AGENT_HARNESS_EGRESS]).toBe(75);
    expect(new Set(Object.values(GATEWAY_PRIORITIES)).size).toBe(
      Object.keys(GATEWAY_PRIORITIES).length
    );
    for (const stack of ['dev', 'prod'])
      expect(`ah-egress-gateway-${stack}-tg`.length).toBeLessThanOrEqual(32);
  });

  test('registers exactly both gateway targets and waits for both listener associations', () => {
    const ecs = resource(service, 'awsx.ecs.FargateService');
    expect(ecs.arguments![0].getText()).toBe('`${BASE_NAME}`');
    expect(shape(property(ecs.arguments![1], 'loadBalancers'))).toEqual([
      {
        targetGroupArn: 'gatewayTargetGroup.target_group.arn',
        containerName: "'service'",
        containerPort: 'serviceContainerPort',
      },
      {
        targetGroupArn: 'this.egressTargetGroup.arn',
        containerName: "'service'",
        containerPort: 'egressContainerPort',
      },
    ]);
    expect(shape(ecs.arguments![2])).toEqual({
      parent: 'this',
      dependsOn: ['gatewayTargetGroup.listener_rule', 'egress.listener_rule'],
    });
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
      {
        appProtocol: "'http'",
        name: '`${BASE_NAME}-egress-tcp-${stack}`',
        hostPort: 'egressContainerPort',
        containerPort: 'egressContainerPort',
        targetGroup: 'this.egressTargetGroup',
      },
    ]);
    for (const [key, value] of [
      ['stopTimeout', '120'],
      ['cpu', '1024'],
      ['memory', '2048'],
    ]) {
      expect(property(container, key).getText()).toBe(value);
    }
    for (const [key, value] of [
      ['desiredCount', '2'],
      ['healthCheckGracePeriodSeconds', '120'],
      ['deploymentMinimumHealthyPercent', '100'],
      ['deploymentMaximumPercent', '200'],
    ]) {
      expect(property(ecs.arguments![1], key).getText()).toBe(value);
    }
    expect(
      shape(property(ecs.arguments![1], 'deploymentCircuitBreaker'))
    ).toEqual({ enable: 'true', rollback: 'true' });
    expect(shape(property(ecs.arguments![1], 'networkConfiguration'))).toEqual({
      subnets: 'vpc.privateSubnetIds',
      securityGroups: ['serviceSg.id'],
    });
    const caller = resource(index, 'AgentHarnessService');
    for (const [key, value] of [
      ['serviceContainerPort', '8101'],
      ['egressContainerPort', '8102'],
      ['healthCheckPath', "'/health'"],
    ]) {
      expect(property(caller.arguments![1], key).getText()).toBe(value);
    }
  });

  test('preserves the task security group and outbound rule without legacy ALB rules', () => {
    const sg = resource(service, 'aws.ec2.SecurityGroup');
    expect(sg.arguments![0].getText()).toBe('`${BASE_NAME}-sg-${stack}`');
    expect(shape(sg.arguments![1])).toEqual({
      name: '`${BASE_NAME}-sg-${stack}`',
      vpcId: 'vpcId',
      description: '`${BASE_NAME} service security group`',
      tags: 'this.tags',
    });
    expect(shape(sg.arguments![2])).toEqual({ parent: 'this' });
    const outbound = resource(service, 'aws.vpc.SecurityGroupEgressRule');
    expect(outbound.arguments![0].getText()).toBe('`${BASE_NAME}-service-out`');
    expect(shape(outbound.arguments![1])).toEqual({
      securityGroupId: 'serviceSg.id',
      description: "'Allow all outbound traffic'",
      cidrIpv4: "'0.0.0.0/0'",
      ipProtocol: "'-1'",
      tags: 'this.tags',
    });
    expect(
      nodes(service, ts.isNewExpression).filter(
        (node) =>
          node.expression.getText() === 'aws.vpc.SecurityGroupIngressRule'
      )
    ).toHaveLength(0);
  });

  test('exports the prefixed egress URL in dev and prod without a dedicated hostname', () => {
    expect(assignment('this.egressDomain')).toBe(
      'getServiceUrl(ServiceUrl.AGENT_HARNESS_EGRESS_URL)'
    );
    expect(variable(index, 'agentHarnessEgressUrl').getText()).toBe(
      'pulumi.interpolate`${service.egressDomain}`'
    );
    const urls = parse('../../packages/shared/src/service_urls.ts');
    for (const [map, host] of [
      ['DEV_SERVICE_URLS', 'dev-gateway'],
      ['PROD_SERVICE_URLS', 'gateway'],
    ]) {
      expect(
        property(
          variable(urls, map),
          '[ServiceUrl.AGENT_HARNESS_EGRESS_URL]'
        ).getText()
      ).toBe(`'https://${host}.macro.com/agent-harness-egress'`);
    }
  });

  test('keeps the gateway URL and role outputs and uses the canonical URL for BASE_URL', () => {
    expect(assignment('this.domain')).toBe(
      'getServiceUrl(ServiceUrl.AGENT_HARNESS_SERVICE_URL)'
    );
    const output = variable(index, 'agentHarnessServiceUrl');
    expect(ts.isCallExpression(output)).toBe(true);
    expect((output as ts.CallExpression).expression.getText()).toBe(
      'getServiceUrl'
    );
    expect((output as ts.CallExpression).arguments[0].getText()).toBe(
      'ServiceUrl.AGENT_HARNESS_SERVICE_URL'
    );
    expect(variable(index, 'agentHarnessServiceRoleArn').getText()).toBe(
      'service.role.arn'
    );
    const urls = parse('../../packages/shared/src/service_urls.ts');
    for (const [map, host] of [
      ['DEV_SERVICE_URLS', 'dev-gateway'],
      ['PROD_SERVICE_URLS', 'gateway'],
    ]) {
      expect(
        property(
          variable(urls, map),
          '[ServiceUrl.AGENT_HARNESS_SERVICE_URL]'
        ).getText()
      ).toBe(`'https://${host}.macro.com/agent-harness'`);
    }
    const ecs = resource(service, 'awsx.ecs.FargateService');
    const env = property(
      ecs.arguments![1],
      'taskDefinitionArgs',
      'containers',
      'service',
      'environment'
    );
    expect(nodes(env, ts.isObjectLiteralExpression).map(shape)).toContainEqual({
      name: "'BASE_URL'",
      value: 'this.domain',
    });
  });

  test('keeps the streaming idle timeout at 3600 seconds on the shared gateway', () => {
    const gateway = resource(
      parse('../gateway/index.ts'),
      'MacroApplicationLoadBalancer'
    );
    expect(property(gateway.arguments![1], 'idleTimeout').getText()).toBe(
      '3600'
    );
  });
});
