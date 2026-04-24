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
        'http://localhost:3001',
        'http://localhost:3002',
        'http://localhost:3003',
        'http://localhost:3004',
        'http://localhost:3005',
        'http://localhost:3006',
        'http://localhost:3007',
        'http://localhost:3008',
        'http://localhost:3009',
        'http://localhost:5173',
        'https://github.com',
        'https://claude.ai',
        'https://chatgpt.com',
        'https://chat.openai.com',
      ];
    case 'dev':
      return [
        ...allowedOrigins,
        'http://localhost:3000',
        'http://localhost:3001',
        'http://localhost:3002',
        'http://localhost:3003',
        'http://localhost:3004',
        'http://localhost:3005',
        'http://localhost:3006',
        'http://localhost:3007',
        'http://localhost:3008',
        'http://localhost:3009',
        'https://dev.macro.com',
        'http://localhost:8084',
        'http://localhost:5173',
        'https://dashboarddev.macro.com',
        'https://github.com',
        'https://claude.ai',
        'https://chatgpt.com',
        'https://chat.openai.com',
      ];
    case 'prod':
      return [
        ...allowedOrigins,
        'https://macro.com',
        'https://dashboard.macro.com',
        'https://staging.macro.com',
        'https://www.macro.com',
        'https://pdf.macro.com',
        'https://github.com',
        'https://claude.ai',
        'https://chatgpt.com',
        'https://chat.openai.com',
      ];
  }

  throw new Error('invalid stack');
};
