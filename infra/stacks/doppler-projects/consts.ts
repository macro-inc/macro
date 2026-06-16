import { config } from '../../packages/shared/src';

export const DOPPLER_SECRETS_MANAGER_INTEGRATION_ID = config.requireSecret(
  'doppler_secrets_manager_integration_id'
);
export const SECRETS_MANAGER_REGION = 'us-east-1';
