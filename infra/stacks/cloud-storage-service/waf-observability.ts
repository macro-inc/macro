import * as aws from '@pulumi/aws';
import * as datadog from '@pulumi/datadog';
import * as pulumi from '@pulumi/pulumi';

const ACCOUNT_ID = '569036502058';
const REGION = 'us-east-1';
const WEB_ACL_NAME = 'macro-cloud-storage-prod';
const WEB_ACL_ID = '0f1059a5-1ee4-4b57-a429-88df830d5091';
const WEB_ACL_ARN = `arn:aws:wafv2:${REGION}:${ACCOUNT_ID}:regional/webacl/${WEB_ACL_NAME}/${WEB_ACL_ID}`;
const ALB_ARN = `arn:aws:elasticloadbalancing:${REGION}:${ACCOUNT_ID}:loadbalancer/app/cloud-storage-service-alb-prod/d451a7c4e101c61d`;
const IP_SAFETY_RULE_GROUP_ARN = `arn:aws:wafv2:${REGION}:${ACCOUNT_ID}:regional/rulegroup/ip_safety/0a1bfeec-4d6c-4afe-bf35-b93e06c65f9b`;
const WAF_LOG_GROUP_NAME = 'aws-waf-logs-macro-cloud-storage-prod';
const DATADOG_FORWARDER_ARN = `arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:DatadogIntegration-ForwarderStack-BS3QDP-Forwarder-O0hyWQ9Yq4uQ`;
const SENSITIVE_HEADERS = [
  'authorization',
  'cookie',
  'x-api-key',
  'x-cal-signature-256',
  'x-document-storage-service-auth-key',
  'x-document-storage-service-session-id',
  'x-document-storage-service-user-id',
  'x-email-link-id',
  'x-hub-signature-256',
  'x-internal-auth-key',
  'x-internal-fusionauth-user-id',
  'x-internal-macro-user-id',
  'x-internal-macro-organization-id',
  'x-macro-bot-token',
  'x-macro-channel-bot-token',
  'x-macro-bot-for-fusionauth-user-id',
  'x-macro-bot-for-macro-user-id',
  'x-macro-bot-for-organization-id',
  'x-macro-internal-call',
  'x-macro-signature',
  'x-macro-user-api-key',
  'x-permissions-token',
] as const;

interface WafObservabilityArgs {
  albArn: pulumi.Input<string>;
}

const visibilityConfig = (metricName: string) => ({
  cloudwatchMetricsEnabled: true,
  metricName,
  sampledRequestsEnabled: false,
});

const managedRule = (
  name: string,
  priority: number,
  managedRuleGroupStatement: aws.types.input.wafv2.WebAclRuleStatementManagedRuleGroupStatement
): aws.types.input.wafv2.WebAclRule => ({
  name,
  priority,
  overrideAction: { none: {} },
  statement: { managedRuleGroupStatement },
  visibilityConfig: visibilityConfig(name),
});

const messagePostStatement = (
  regexPatternSetArn: pulumi.Input<string>
): aws.types.input.wafv2.WebAclRuleStatement => ({
  andStatement: {
    statements: [
      {
        byteMatchStatement: {
          fieldToMatch: { method: {} },
          positionalConstraint: 'EXACTLY',
          searchString: 'POST',
          textTransformations: [{ priority: 0, type: 'NONE' }],
        },
      },
      {
        regexPatternSetReferenceStatement: {
          arn: regexPatternSetArn,
          fieldToMatch: { uriPath: {} },
          textTransformations: [{ priority: 0, type: 'NONE' }],
        },
      },
    ],
  },
});

export class WafObservability extends pulumi.ComponentResource {
  constructor(
    name: string,
    args: WafObservabilityArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('macro:cloud-storage:WafObservability', name, args, opts);

    const childOptions = { parent: this, protect: true };
    const adoptedOptions = {
      parent: this,
      protect: true,
    };

    const messagePostPaths = new aws.wafv2.RegexPatternSet(
      `${name}-message-post-paths`,
      {
        name: 'cloud-storage-message-post-prod',
        description: 'Exact channel message creation URI paths',
        scope: 'REGIONAL',
        regularExpressions: [
          {
            regexString:
              '^/channels/[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[89AaBb][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}/message$',
          },
        ],
      },
      childOptions
    );

    const webAcl = new aws.wafv2.WebAcl(
      `${name}-web-acl`,
      {
        name: WEB_ACL_NAME,
        description: 'Cloud Storage WAF for production resources',
        scope: 'REGIONAL',
        defaultAction: { allow: {} },
        dataProtectionConfig: {
          dataProtections: [
            {
              action: 'SUBSTITUTION',
              field: { fieldType: 'BODY' },
            },
            {
              action: 'SUBSTITUTION',
              field: {
                fieldType: 'SINGLE_HEADER',
                fieldKeys: [...SENSITIVE_HEADERS],
              },
            },
            {
              action: 'SUBSTITUTION',
              field: { fieldType: 'QUERY_STRING' },
            },
          ],
        },
        rules: [
          managedRule('AWS-AWSManagedRulesAmazonIpReputationList', 0, {
            name: 'AWSManagedRulesAmazonIpReputationList',
            vendorName: 'AWS',
          }),
          managedRule('AWS-AWSManagedRulesBotControlRuleSet', 1, {
            name: 'AWSManagedRulesBotControlRuleSet',
            vendorName: 'AWS',
            managedRuleGroupConfigs: [
              {
                awsManagedRulesBotControlRuleSet: {
                  inspectionLevel: 'COMMON',
                },
              },
            ],
            ruleActionOverrides: [
              {
                name: 'SignalNonBrowserUserAgent',
                actionToUse: { count: {} },
              },
              {
                name: 'CategoryHttpLibrary',
                actionToUse: { count: {} },
              },
            ],
          }),
          managedRule('AWS-AWSManagedRulesKnownBadInputsRuleSet', 2, {
            name: 'AWSManagedRulesKnownBadInputsRuleSet',
            vendorName: 'AWS',
          }),
          managedRule('AWS-AWSManagedRulesSQLiRuleSet', 3, {
            name: 'AWSManagedRulesSQLiRuleSet',
            vendorName: 'AWS',
            ruleActionOverrides: [
              {
                name: 'SQLi_BODY',
                actionToUse: { count: {} },
              },
            ],
          }),
          {
            name: 'BlockSQLiBody',
            priority: 4,
            action: { block: {} },
            statement: {
              andStatement: {
                statements: [
                  {
                    labelMatchStatement: {
                      key: 'awswaf:managed:aws:sql-database:SQLi_Body',
                      scope: 'LABEL',
                    },
                  },
                  {
                    notStatement: {
                      statement: messagePostStatement(messagePostPaths.arn),
                    },
                  },
                ],
              },
            },
            visibilityConfig: visibilityConfig('BlockSQLiBody'),
          },
          {
            name: 'ip_safety',
            priority: 5,
            overrideAction: { none: {} },
            statement: {
              ruleGroupReferenceStatement: {
                arn: IP_SAFETY_RULE_GROUP_ARN,
              },
            },
            visibilityConfig: visibilityConfig('ip_safety'),
          },
        ],
        visibilityConfig: visibilityConfig(WEB_ACL_NAME),
      },
      {
        ...adoptedOptions,
        import: `${WEB_ACL_ID}/${WEB_ACL_NAME}/REGIONAL`,
      }
    );

    new aws.wafv2.WebAclAssociation(
      `${name}-web-acl-association`,
      {
        resourceArn: args.albArn,
        webAclArn: webAcl.arn,
      },
      {
        ...adoptedOptions,
        import: `${WEB_ACL_ARN},${ALB_ARN}`,
      }
    );

    const logGroup = new aws.cloudwatch.LogGroup(
      `${name}-log-group`,
      {
        name: WAF_LOG_GROUP_NAME,
        retentionInDays: 7,
      },
      {
        ...adoptedOptions,
        import: WAF_LOG_GROUP_NAME,
      }
    );

    const loggingConfiguration = new aws.wafv2.WebAclLoggingConfiguration(
      `${name}-logging`,
      {
        resourceArn: webAcl.arn,
        logDestinationConfigs: [logGroup.arn],
        loggingFilter: {
          defaultBehavior: 'DROP',
          filters: [
            {
              behavior: 'KEEP',
              requirement: 'MEETS_ANY',
              conditions: [
                { actionCondition: { action: 'BLOCK' } },
                { actionCondition: { action: 'CHALLENGE' } },
              ],
            },
          ],
        },
        redactedFields: [
          ...SENSITIVE_HEADERS.map((name) => ({ singleHeader: { name } })),
          { queryString: {} },
          { uriPath: {} },
        ],
      },
      {
        ...adoptedOptions,
        import: WEB_ACL_ARN,
      }
    );

    const forwarderPermission = new aws.lambda.Permission(
      `${name}-forwarder-permission`,
      {
        statementId: 'AllowCloudWatchLogsAwsWafProd',
        action: 'lambda:InvokeFunction',
        function: DATADOG_FORWARDER_ARN,
        principal: `logs.${REGION}.amazonaws.com`,
        sourceAccount: ACCOUNT_ID,
        sourceArn: pulumi.interpolate`${logGroup.arn}:*`,
      },
      childOptions
    );

    new aws.cloudwatch.LogSubscriptionFilter(
      `${name}-forwarder-subscription`,
      {
        name: 'datadog-forwarder',
        destinationArn: DATADOG_FORWARDER_ARN,
        filterPattern: '{ ($.action = "BLOCK") || ($.action = "CHALLENGE") }',
        logGroup: logGroup.name,
      },
      {
        ...childOptions,
        dependsOn: [forwarderPermission, loggingConfiguration],
      }
    );

    const datadogPipeline = new datadog.LogsCustomPipeline(
      `${name}-datadog-pipeline`,
      {
        name: 'Macro Cloud Storage AWS WAF',
        description:
          'Parses and normalizes blocked or challenged AWS WAF requests for cloud-storage-service.',
        isEnabled: true,
        filters: [
          {
            query: '"macro-cloud-storage-prod"',
          },
        ],
        tags: ['env:prod', 'service:cloud-storage-service', 'source:waf'],
        processors: [
          {
            grokParser: {
              name: 'Parse AWS WAF JSON',
              isEnabled: true,
              source: 'message',
              samples: [
                '{"timestamp":0,"webaclId":"arn:aws:wafv2:us-east-1:569036502058:regional/webacl/macro-cloud-storage-prod/0f1059a5-1ee4-4b57-a429-88df830d5091","action":"BLOCK","httpRequest":{"clientIp":"192.0.2.1","uri":"/","httpMethod":"GET"}}',
              ],
              grok: {
                matchRules: 'waf_json %{data::json}',
                supportRules: '',
              },
            },
          },
          {
            grokParser: {
              name: 'Parse W3C traceparent',
              isEnabled: true,
              source: 'message',
              samples: [
                '{"httpRequest":{"headers":[{"name":"traceparent","value":"00-4BF92F3577B34DA6A3CE929D0E0E4736-00F067AA0BA902B7-01"}]}}',
              ],
              grok: {
                matchRules:
                  'traceparent %{traceparentPrefix}%{regex("[0-9A-Fa-f]{32}"):waf.trace_id:lowercase}-%{regex("[0-9A-Fa-f]{16}"):waf.span_id:lowercase}-%{regex("[0-9A-Fa-f]{2}")}%{data}',
                supportRules:
                  'traceparentPrefix .*"name"\\s*:\\s*"[Tt][Rr][Aa][Cc][Ee][Pp][Aa][Rr][Ee][Nn][Tt]"\\s*,\\s*"value"\\s*:\\s*"00-',
              },
            },
          },
          {
            attributeRemapper: {
              name: 'Normalize WAF web ACL ARN',
              isEnabled: true,
              sources: ['webaclId'],
              sourceType: 'attribute',
              target: 'waf.web_acl_arn',
              targetType: 'attribute',
              preserveSource: true,
              overrideOnConflict: false,
            },
          },
          {
            attributeRemapper: {
              name: 'Normalize WAF request ID',
              isEnabled: true,
              sources: ['httpRequest.requestId'],
              sourceType: 'attribute',
              target: 'waf.request_id',
              targetType: 'attribute',
              preserveSource: true,
              overrideOnConflict: false,
            },
          },
          {
            attributeRemapper: {
              name: 'Normalize WAF rule ID',
              isEnabled: true,
              sources: ['terminatingRuleId'],
              sourceType: 'attribute',
              target: 'waf.rule_id',
              targetType: 'attribute',
              preserveSource: true,
              overrideOnConflict: false,
            },
          },
          {
            attributeRemapper: {
              name: 'Normalize WAF action',
              isEnabled: true,
              sources: ['action'],
              sourceType: 'attribute',
              target: 'waf.action',
              targetType: 'attribute',
              preserveSource: true,
              overrideOnConflict: false,
            },
          },
          {
            attributeRemapper: {
              name: 'Normalize client IP',
              isEnabled: true,
              sources: ['httpRequest.clientIp'],
              sourceType: 'attribute',
              target: 'network.client.ip',
              targetType: 'attribute',
              preserveSource: true,
              overrideOnConflict: false,
            },
          },
          {
            attributeRemapper: {
              name: 'Normalize HTTP method',
              isEnabled: true,
              sources: ['httpRequest.httpMethod'],
              sourceType: 'attribute',
              target: 'http.method',
              targetType: 'attribute',
              preserveSource: true,
              overrideOnConflict: false,
            },
          },
          {
            attributeRemapper: {
              name: 'Normalize HTTP version',
              isEnabled: true,
              sources: ['httpRequest.httpVersion'],
              sourceType: 'attribute',
              target: 'http.version',
              targetType: 'attribute',
              preserveSource: true,
              overrideOnConflict: false,
            },
          },
          {
            geoIpParser: {
              name: 'Enrich client IP',
              isEnabled: true,
              sources: ['network.client.ip'],
              target: 'network.client.geoip',
            },
          },
          {
            dateRemapper: {
              name: 'Use WAF event time',
              isEnabled: true,
              sources: ['timestamp'],
            },
          },
          {
            stringBuilderProcessor: {
              name: 'Set service',
              isEnabled: true,
              target: 'waf.service',
              template: 'cloud-storage-service',
              isReplaceMissing: true,
            },
          },
          {
            categoryProcessor: {
              name: 'Set WAF response status',
              isEnabled: true,
              target: 'http.response.status_code',
              categories: [
                {
                  name: '403',
                  filter: { query: '@action:BLOCK' },
                },
                {
                  name: '202',
                  filter: { query: '@action:CHALLENGE' },
                },
              ],
            },
          },
          {
            stringBuilderProcessor: {
              name: 'Set environment',
              isEnabled: true,
              target: 'env',
              template: 'prod',
              isReplaceMissing: true,
            },
          },
          {
            stringBuilderProcessor: {
              name: 'Set source',
              isEnabled: true,
              target: 'source',
              template: 'waf',
              isReplaceMissing: true,
            },
          },
          {
            traceIdRemapper: {
              name: 'Remap trace ID',
              isEnabled: true,
              sources: ['waf.trace_id'],
            },
          },
          {
            spanIdRemapper: {
              name: 'Remap span ID',
              isEnabled: true,
              sources: ['waf.span_id'],
            },
          },
          {
            serviceRemapper: {
              name: 'Remap service',
              isEnabled: true,
              sources: ['waf.service'],
            },
          },
        ],
      },
      {
        parent: this,
        protect: true,
      }
    );

    const currentPipelineOrder = datadog.getLogsPipelinesOrderOutput();
    new datadog.LogsPipelineOrder(
      `${name}-datadog-pipeline-order`,
      {
        name: 'macro-cloud-storage-waf-pipeline-order',
        pipelines: pulumi
          .all([currentPipelineOrder.pipelineIds, datadogPipeline.id])
          .apply(([pipelineIds, pipelineId]) => [
            pipelineId,
            ...pipelineIds.filter((id) => id !== pipelineId),
          ]),
      },
      {
        parent: this,
        protect: true,
      }
    );

    this.registerOutputs({
      webAclArn: webAcl.arn,
      logGroupName: logGroup.name,
    });
  }
}
