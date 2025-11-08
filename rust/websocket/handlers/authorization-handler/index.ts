import type {
  APIGatewayAuthorizerResult,
  APIGatewayRequestAuthorizerEvent,
  APIGatewayRequestAuthorizerHandler,
  PolicyDocument,
  Statement,
} from 'aws-lambda';
import { type JwtPayload, verify } from 'jsonwebtoken';

interface Config {
  fusionAuthJwtSecretKey: string;
  isDev: boolean;
  macroAccessTokenCookie: string;
}

interface EmailJwtPayload extends JwtPayload {
  email: string;
}

const getConfig = (): Config => {
  const fusionAuthJwtSecretKey = process.env.FUSIONAUTH_JWT_SECRET_KEY;
  if (!fusionAuthJwtSecretKey) {
    throw new Error(
      'FUSIONAUTH_JWT_SECRET_KEY environment variable is required'
    );
  }

  const isDev = process.env.ENVIRONMENT === 'dev';
  const macroAccessTokenCookie = `${isDev ? 'dev-' : ''}macro-access-token`;

  return {
    fusionAuthJwtSecretKey,
    isDev,
    macroAccessTokenCookie,
  };
};

const ALLOWED_ORIGIN_PATTERN =
  /^https:\/\/(?:.+\.)*macro\.com$|^http:\/\/localhost:3000$|^http:\/\/host\.local:3000$/;

function validateOrigin(origin: string): boolean {
  return ALLOWED_ORIGIN_PATTERN.test(origin);
}

function getCookieValue(
  cookieHeader: string,
  cookieName: string
): string | null {
  const cookies = cookieHeader.split(';').map((cookie) => cookie.trim());
  const cookie = cookies.find((cookie) => cookie.startsWith(`${cookieName}=`));
  return cookie ? cookie.split('=')[1] : null;
}

function verifyJWT(token: string, secretKey: string): EmailJwtPayload | null {
  try {
    const payload = verify(token, secretKey);
    if (
      payload &&
      typeof payload === 'object' &&
      'email' in payload &&
      typeof payload.email === 'string'
    ) {
      return payload as EmailJwtPayload;
    }
    console.error('Decoded payload is not a valid Macro JWT payload', payload);
    return null;
  } catch (error) {
    console.error(
      'Token verification failed:',
      error instanceof Error ? error.message : 'Unknown error'
    );
    return null;
  }
}

function generatePolicy(
  principalId: string,
  effect: 'Allow' | 'Deny',
  resource: string
): APIGatewayAuthorizerResult {
  const statementOne: Statement = {
    Action: 'execute-api:Invoke',
    Effect: effect,
    Resource: resource,
  };

  const policyDocument: PolicyDocument = {
    Version: '2012-10-17',
    Statement: [statementOne],
  };

  return {
    principalId,
    policyDocument,
  };
}

function generateAllow(
  principalId: string,
  resource: string
): APIGatewayAuthorizerResult {
  return generatePolicy(principalId, 'Allow', resource);
}

function generateDeny(
  principalId: string,
  resource: string
): APIGatewayAuthorizerResult {
  return generatePolicy(principalId, 'Deny', resource);
}

function denyAccess(
  reason: string,
  methodArn: string
): APIGatewayAuthorizerResult {
  console.log('denyAccess', reason);
  return generateDeny('user', methodArn);
}

function allowAccess(
  awsAccountId: string,
  methodArn: string,
  additionalContext: Record<string, string>
): APIGatewayAuthorizerResult {
  const policy = generateAllow(awsAccountId, methodArn);
  policy.context = additionalContext;
  return policy;
}

export const handler: APIGatewayRequestAuthorizerHandler = async (
  event: APIGatewayRequestAuthorizerEvent
): Promise<APIGatewayAuthorizerResult> => {
  const config = getConfig();

  console.log('Received event:', JSON.stringify(event, null, 2));

  const tmp = event.methodArn.split(':');
  const awsAccountId = tmp[4];

  const origin = event.headers?.origin || event.headers?.Origin;
  if (!origin || !validateOrigin(origin)) {
    return denyAccess('Invalid origin found in the request', event.methodArn);
  }

  const cookieHeader = event.headers?.cookie || event.headers?.Cookie;
  if (!cookieHeader) {
    return allowAccess(awsAccountId, event.methodArn, {});
  }

  const macroAccessToken = getCookieValue(
    cookieHeader,
    config.macroAccessTokenCookie
  );
  if (!macroAccessToken) {
    return allowAccess(awsAccountId, event.methodArn, {});
  }

  const payload = verifyJWT(macroAccessToken, config.fusionAuthJwtSecretKey);
  const email = payload?.email;
  if (!email) {
    return denyAccess('invalid macro access token', event.methodArn);
  }

  return allowAccess(awsAccountId, event.methodArn, {
    authenticated_email: email,
  });
};
