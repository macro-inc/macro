import { Environment } from './environment';
import { type RateLimitConfig, createRateLimitConfig } from './rateLimitConfig';

type AppConfig = {
  environment: Environment;
  port: number;
  logLevel: string;
  consumerHost: string;
  consumerPort: string;
  jobResponseLambda: string;
  redisHost: string;
  redisPort: number;
  rateLimitConfig: RateLimitConfig;
};

let _config: AppConfig;

export function config(): AppConfig {
  if (!_config) {
    _config = createConfig();
  }

  return _config;
}

function createConfig(): AppConfig {
  const env = process.env.ENVIRONMENT ?? 'local';
  let environment: Environment;
  switch (env) {
    case 'local':
      environment = Environment.LOCAL;
      break;
    case 'dev':
      environment = Environment.DEV;
      break;
    case 'prod':
      environment = Environment.PROD;
      break;
    default:
      throw new Error(`Unsupported environment ${env}`);
  }

  const c = {
    environment,
    port: process.env.PORT ? parseInt(process.env.PORT, 10) : 8080,
    logLevel: process.env.LOG_LEVEL ?? 'debug',
    consumerHost: process.env.CONSUMER_HOST ?? '',
    consumerPort: process.env.CONSUMER_PORT ?? '',
    jobResponseLambda: process.env.JOB_RESPONSE_LAMBDA ?? '',
    redisHost: process.env.REDIS_HOST ?? '',
    redisPort: process.env.REDIS_PORT
      ? parseInt(process.env.REDIS_PORT, 10)
      : 6379,
    rateLimitConfig: createRateLimitConfig(environment),
  };

  Object.keys(c).forEach((key) => {
    if (!c[key as keyof AppConfig] || c[key as keyof AppConfig] === '') {
      throw new Error(`Missing config value: ${key}`);
    }
  });

  return c;
}
