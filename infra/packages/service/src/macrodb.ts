import { stack } from '@shared';

export function getMacroDbSecretName() {
  return stack === 'prod' ? 'macro-db-prod' : 'macro-db-dev';
}

export function getMacroDbEnv() {
  return {
    DATABASE_URL_SECRET_NAME: getMacroDbSecretName(),
  };
}
