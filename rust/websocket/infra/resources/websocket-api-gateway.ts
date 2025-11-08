import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import * as std from '@pulumi/std';
import {
  BASE_DOMAIN,
  MACRO_SUBDOMAIN_CERT,
  accountId,
  awsRegion,
  stack,
} from './shared';

const BASE_NAME = 'websocket-api-gateway';

// WebsocketApiGateway component resource class
export class WebsocketApiGateway extends pulumi.ComponentResource {
  public readonly api: aws.apigatewayv2.Api;
  public readonly apiEndpoint: pulumi.Output<string>;
  public deployment: pulumi.Output<aws.apigatewayv2.Deployment | null> =
    pulumi.output(null);

  private readonly logGroup: aws.cloudwatch.LogGroup;
  private routes: pulumi.Output<string[]> = pulumi.output([]);
  private readonly ROUTE_SELECTION_EXPRESSION = '$request.body.action';
  private authorizer: aws.apigatewayv2.Authorizer | null = null;

  private readonly apiDomainName: aws.apigatewayv2.DomainName;
  private readonly domainName = `services${
    stack === 'prod' ? '' : `-${stack}`
  }.${BASE_DOMAIN}`;

  public readonly stageName = '$default';

  /**
   * The constructor for the WebsocketApiGateway component resource.
   * @param name The _unique_ name of the resource.
   * @param args The arguments to use to populate this resource's properties.
   * @param opts A bag of options that control this resource's behavior.
   */
  constructor(opts?: pulumi.ComponentResourceOptions) {
    const name = `${BASE_NAME}-${stack}`;
    super('custom:apigateway:WebsocketApiGateway', name, {}, opts);

    // Create the WebSocket API
    const description = `WebSocket API Gateway for handling connections to Macro application (${stack})`;
    this.api = new aws.apigatewayv2.Api(
      name,
      {
        name: name,
        protocolType: 'WEBSOCKET',
        disableExecuteApiEndpoint: true,
        routeSelectionExpression: this.ROUTE_SELECTION_EXPRESSION,
        description: description,
        apiKeySelectionExpression: '$context.authorizer.usageIdentifierKey',
      },
      { parent: this },
    );

    // Output the WebSocket API endpoint
    this.apiEndpoint = this.api.apiEndpoint;

    // Create a log group for the WebSocket API
    this.logGroup = new aws.cloudwatch.LogGroup(
      `${BASE_NAME}-log-group-${stack}`,
      {
        name: `/aws/apigateway/${name}`,
        retentionInDays: 1,
      },
      { parent: this },
    );

    // enable logging for the WebSocket API
    const role = new aws.iam.Role(
      `${BASE_NAME}-log-group-role-${stack}`,
      {
        assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
          Service: 'apigateway.amazonaws.com',
        }),
        managedPolicyArns: [
          aws.iam.ManagedPolicies.AmazonAPIGatewayPushToCloudWatchLogs,
        ],
      },
      { parent: this },
    );

    const zoneId = aws.route53
      .getZone({
        name: 'macro.com',
      })
      .then(zone => zone.zoneId);

    const apiDomainName = new aws.apigatewayv2.DomainName(
      `${BASE_NAME}-domain-name-${stack}`,
      {
        domainName: this.domainName,
        domainNameConfiguration: {
          certificateArn: MACRO_SUBDOMAIN_CERT,
          endpointType: 'REGIONAL',
          securityPolicy: 'TLS_1_2',
        },
      },
    );
    this.apiDomainName = apiDomainName;

    const dnsRecord = new aws.route53.Record(
      `${BASE_NAME}-domain-record-${stack}`,
      {
        zoneId,
        name: apiDomainName.domainName,
        type: 'A',
        aliases: [
          {
            evaluateTargetHealth: true,
            name: apiDomainName.domainNameConfiguration.targetDomainName,
            zoneId: apiDomainName.domainNameConfiguration.hostedZoneId,
          },
        ],
      },
    );

    // Register output properties for the component
    this.registerOutputs({
      api: this.api,
      apiEndpoint: this.apiEndpoint,
    });
  }

  /**
   * @returns HTTPS endpoint for the WebSocket API Gateway.
   */
  public getEndpoint(): string {
    return `https://${this.domainName}`;
  }

  /**
   * Add an integration to the WebSocket API Gateway.
   * @param name The name of the integration.
   * @param lambdaInvokeArn The ARN of the Lambda function to integrate with.
   */
  public addIntegration({
    name,
    lambdaInvokeArn,
  }: {
    name: pulumi.Input<string>;
    lambdaInvokeArn: pulumi.Input<string>;
  }): aws.apigatewayv2.Integration {
    return new aws.apigatewayv2.Integration(
      `${BASE_NAME}-${name}-integration-${stack}`,
      {
        apiId: this.api.id,
        integrationType: 'AWS_PROXY',
        connectionType: 'INTERNET',
        integrationUri: lambdaInvokeArn,
      },
      { parent: this },
    );
  }

  /**
   * Add a route to the WebSocket API Gateway.
   * @param routeKey The route key for the route.
   * @param integration The integration for the route.
   */
  public addRoute({
    routeKey,
    integration,
  }: {
    routeKey: string;
    integration: aws.apigatewayv2.Integration;
  }): aws.apigatewayv2.Route {
    console.log(`Adding route: ${routeKey}`);
    this.routes = this.routes.apply(routes => {
      return [...routes, routeKey];
    });
    return new aws.apigatewayv2.Route(
      `${BASE_NAME}-${routeKey}-route-${stack}`,
      {
        apiId: this.api.id,
        routeKey: routeKey,
        target: pulumi.interpolate`integrations/${integration.id}`,
      },
      { parent: this },
    );
  }

  /**
   * Add a route to the WebSocket API Gateway.
   * NOTE: You will still need to manually enable two-way communication in the API Gateway console.
   * @param routeKey The route key for the route.
   * @param integration The integration for the route.
   */
  public addConnectRoute({
    withAuthorizer,
    integration,
  }: {
    withAuthorizer?: boolean;
    integration?: aws.apigatewayv2.Integration;
  }): aws.apigatewayv2.Route {
    const routeKey = '$connect';
    console.log(`Adding route: ${routeKey}`);
    const mockIntegration = new aws.apigatewayv2.Integration(
      `${BASE_NAME}-${routeKey}-integration-${stack}`,
      {
        apiId: this.api.id,
        integrationType: 'MOCK',
        connectionType: 'INTERNET',
        requestTemplates: {
          '200': JSON.stringify({
            statusCode: 200,
          }),
        },
        templateSelectionExpression: '200',
      },
      { parent: this },
    );
    // respond with a 200 status code
    const integrationResponse = new aws.apigatewayv2.IntegrationResponse(
      `${BASE_NAME}-${routeKey}-integration-response-${stack}`,
      {
        apiId: this.api.id,
        integrationId: mockIntegration.id,
        integrationResponseKey: '$default',
        responseTemplates: {
          '200': JSON.stringify({
            message: 'Connected',
          }),
        },
        templateSelectionExpression: '200',
      },
      { parent: this },
    );

    this.routes = this.routes.apply(routes => {
      return [...routes, routeKey];
    });

    return new aws.apigatewayv2.Route(
      `${BASE_NAME}-${routeKey}-route-${stack}`,
      {
        apiId: this.api.id,
        routeKey: routeKey,
        target: pulumi.interpolate`integrations/${
          integration == undefined ? mockIntegration.id : integration.id
        }`,
        authorizationType: withAuthorizer ? 'CUSTOM' : 'NONE',
        authorizerId: withAuthorizer ? this.authorizer?.id : undefined,
        routeResponseSelectionExpression: `\$default`,
      },
      { parent: this },
    );
  }

  /**
   * Add a stage to the WebSocket API Gateway. Ensures routes are added beforehand.
   * @param stageName The name of the stage.
   */
  public addStage(): aws.apigatewayv2.Stage {
    const deployment = this.addDeployment();
    const stage = new aws.apigatewayv2.Stage(
      `${BASE_NAME}-stage-${this.stageName}-${stack}`,
      {
        accessLogSettings: {
          destinationArn: this.logGroup.arn,
          format: JSON.stringify({
            requestId: '$context.requestId',
            requestTime: '$context.requestTime',
            eventType: '$context.eventType',
            routeKey: '$context.routeKey',
            status: '$context.status',
            connectionId: '$context.connectionId',
            messageId: '$context.messageId',
            requestTimeEpoch: '$context.requestTimeEpoch',
            stage: '$context.stage',
            authorize: {
              error: '$context.authorize.error',
              latency: '$context.authorize.latency',
              status: '$context.authorize.status',
            },
            authorizer: {
              error: '$context.authorizer.error',
              integrationLatency: '$context.authorizer.integrationLatency',
              integrationStatus: '$context.authorizer.integrationStatus',
              latency: '$context.authorizer.latency',
              requestId: '$context.authorizer.requestId',
              status: '$context.authorizer.status',
              principalId: '$context.authorizer.principalId',
              property: '$context.authorizer.property',
            },
            authenticate: {
              error: '$context.authenticate.error',
              latency: '$context.authenticate.latency',
              status: '$context.authenticate.status',
            },
            connectedAt: '$context.connectedAt',
            domainName: '$context.domainName',
            error: {
              message: '$context.error.message',
              messageString: '$context.error.messageString',
              responseType: '$context.error.responseType',
              validationErrorString: '$context.error.validationErrorString',
            },
            extendedRequestId: '$context.extendedRequestId',
            identity: {
              ip: '$context.identity.sourceIp',
              caller: '$context.identity.caller',
              user: '$context.identity.user',
              accountId: '$context.identity.accountId',
              apiKey: '$context.identity.apiKey',
              apiKeyId: '$context.identity.apiKeyId',
              cognitoAuthenticationProvider:
                '$context.identity.cognitoAuthenticationProvider',
              cognitoAuthenticationType:
                '$context.identity.cognitoAuthenticationType',
              cognitoIdentityId: '$context.identity.cognitoIdentityId',
              cognitoIdentityPoolId: '$context.identity.cognitoIdentityPoolId',
              principalOrgId: '$context.identity.principalOrgId',
              userAgent: '$context.identity.userAgent',
              userArn: '$context.identity.userArn',
            },
            integration: {
              error: '$context.integration.error',
              latency: '$context.integration.latency',
              requestId: '$context.integration.requestId',
              status: '$context.integration.status',
            },
            waf: {
              error: '$context.waf.error',
              latency: '$context.waf.latency',
              status: '$context.waf.status',
            },
          }),
        },
        apiId: this.api.id,
        autoDeploy: false, // only applicable for HTTP APIs
        name: this.stageName,
        defaultRouteSettings: {
          dataTraceEnabled: true,
          detailedMetricsEnabled: true,
          loggingLevel: 'INFO',
          throttlingBurstLimit: 500,
          throttlingRateLimit: 1000,
        },
        deploymentId: deployment.id,
      },
      { parent: this, dependsOn: [deployment] },
    );

    const mapping = new aws.apigatewayv2.ApiMapping(
      `${BASE_NAME}-mapping-${stack}`,
      {
        apiId: this.api.id,
        domainName: this.domainName,
        stage: this.stageName,
      },
      { dependsOn: [this.apiDomainName, stage] },
    );

    return stage;
  }

  public getLambdaInvokeApiGatewayPolicy(): aws.iam.Policy {
    const apiGatewayInvokePolicy = new aws.iam.Policy(
      `${BASE_NAME}-api-gateway-invoke-policy-${stack}`,
      {
        path: '/',
        description: 'Allows Lambda to invoke API Gateway',
        policy: {
          Version: '2012-10-17',
          Statement: [
            {
              Action: 'execute-api:Invoke',
              Effect: 'Allow',
              Resource: pulumi.interpolate`arn:aws:execute-api:${awsRegion}:${accountId}:${this.api.id}/*`,
            },
            {
              Action: 'execute-api:ManageConnections',
              Effect: 'Allow',
              Resource: pulumi.interpolate`arn:aws:execute-api:${awsRegion}:${accountId}:${this.api.id}/*/POST/@connections/*`,
            },
          ],
        },
      },
    );
    return apiGatewayInvokePolicy;
  }

  /**
   * Adds permissions for the API Gateway to invoke the Lambda function
   * @param name The name of the Lambda function.
   */
  public enableInvokeLambda({ name }: { name: string }): aws.lambda.Permission {
    const integrationInvokePermissions = new aws.lambda.Permission(
      `${BASE_NAME}-${name}-invoke-permissions-${stack}`,
      {
        action: 'lambda:InvokeFunction',
        function: name,
        principal: 'apigateway.amazonaws.com',
        sourceArn: pulumi.interpolate`arn:aws:execute-api:${awsRegion}:${accountId}:${this.api.id}/*`,
      },
    );
    return integrationInvokePermissions;
  }

  /**
   * Adds a deployment to the WebSocket API Gateway.
   */
  private addDeployment(): pulumi.Output<aws.apigatewayv2.Deployment> {
    const stageName = this.stageName;
    const deployment = pulumi.all([this.routes]).apply(([routes]) => {
      console.log(`Deploying routes: ${routes.join(', ')}`);
      return new aws.apigatewayv2.Deployment(
        `${BASE_NAME}-deployment-${stageName}-${stack}`,
        {
          apiId: this.api.id,
          description: `Deployment for stage ${stageName}`,
          triggers: {
            stage: stageName,
            routes: std
              .sha1Output({
                input: pulumi.jsonStringify(routes),
              })
              .apply(invoke => invoke.result),
          },
        },
        { parent: this.api },
      );
    });
    this.deployment = deployment;
    return deployment;
  }

  public addCustomAuthorizer({
    name,
    invokeArn,
  }: {
    name: pulumi.Input<string>;
    invokeArn: pulumi.Input<string>;
  }): aws.apigatewayv2.Authorizer {
    this.authorizer = new aws.apigatewayv2.Authorizer(
      `${BASE_NAME}-authorizer-${stack}`,
      {
        apiId: this.api.id,
        authorizerType: 'REQUEST',
        authorizerUri: invokeArn,
        identitySources: ['route.request.header.Cookie'],
        name,
      },
      { parent: this },
    );
    const methodInvokePermissions = new aws.lambda.Permission(
      `${BASE_NAME}-authorizer-invoke-permissions-${stack}`,
      {
        action: 'lambda:InvokeFunction',
        function: name,
        principal: 'apigateway.amazonaws.com',
        sourceArn: pulumi.interpolate`arn:aws:execute-api:${awsRegion}:${accountId}:${this.api.id}/*`,
      },
    );
    return this.authorizer;
  }
}
