import { stack } from '../../packages/shared';
import { AUTHENTICATION_SERVICE_DOMAIN } from './constants';

/**
 * Creates an array of allowed origins for the fusionauth application depending on stack
 */
export const ALLOWED_ORIGINS = () => {
  const allowedOrigins = [AUTHENTICATION_SERVICE_DOMAIN];
  switch (stack) {
    case 'local':
      return [
        ...allowedOrigins,
        'http://localhost:3000',
        'http://localhost:5173',
      ];
    case 'dev':
      return [
        ...allowedOrigins,
        'http://localhost:3000',
        'https://dev.macro.com',
        'http://localhost:8084',
        'http://localhost:5173',
        'https://dashboarddev.macro.com',
      ];
    case 'prod':
      return [
        ...allowedOrigins,
        'https://macro.com',
        'https://dashboard.macro.com',
        'https://staging.macro.com',
        'https://www.macro.com',
        'https://pdf.macro.com',
      ];
  }

  throw new Error('invalid stack');
};
