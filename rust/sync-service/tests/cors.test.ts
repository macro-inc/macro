import type { Miniflare } from 'miniflare';
import { beforeEach, describe, expect, test } from 'vitest';
import { createTestUser, getTokenForDocument, setupMiniflare } from './utils';

let mf: Miniflare;

beforeEach(async () => {
  mf = await setupMiniflare();
});

describe('CORS middleware tests', async () => {
  test('should allow requests from whitelisted origins', async () => {
    const allowedOrigins = [
      'http://localhost:5173',
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
      'http://host.local:3000',
      'https://dev.macro.com',
      'https://staging.macro.com',
      'https://www.macro.com',
      'https://macro.com',
      'capacitor://localhost',
      'https://apollo-testing.macro.com',
      'https://my-feature-branch.preview.macro.com',
      'https://fix-123.preview.macro.com',
    ];

    const token = getTokenForDocument('test-doc', 'test-user', 'owner');

    for (const origin of allowedOrigins) {
      const response = await mf.dispatchFetch(
        'http://localhost:8787/document/test-doc/metadata',
        {
          headers: {
            Authorization: 'Bearer ' + token,
            Origin: origin,
          },
        }
      );

      // Should get 404 (document doesn't exist) but CORS should be allowed
      expect([200, 404]).toContain(response.status);

      // Check CORS headers
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);
      expect(response.headers.get('Access-Control-Allow-Credentials')).toBe(
        'true'
      );
    }
  });

  test('should handle preflight OPTIONS requests', async () => {
    const response = await mf.dispatchFetch(
      'http://localhost:8787/document/test-doc/metadata',
      {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://dev.macro.com',
          'Access-Control-Request-Method': 'GET',
          'Access-Control-Request-Headers': 'authorization, content-type',
        },
      }
    );

    expect(response.status).toBe(200);

    // Check preflight response headers
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://dev.macro.com'
    );
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBe(
      'true'
    );
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain(
      'GET'
    );
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain(
      'POST'
    );
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain(
      'OPTIONS'
    );
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain(
      'authorization'
    );
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain(
      'content-type'
    );
  });

  test('should reject requests from non-whitelisted origins', async () => {
    const disallowedOrigins = [
      'https://malicious.com',
      'http://localhost:8080',
      'https://evil.macro.com',
      'https://fake-dashboard.macro.com',
      'http://evil.preview.macro.com', // HTTP not allowed for preview
      'https://preview.macro.com', // Must have subdomain
      'https://evil.preview.macro.com.attacker.com', // Suffix attack
    ];

    const token = getTokenForDocument('test-doc', 'test-user', 'owner');

    for (const origin of disallowedOrigins) {
      const response = await mf.dispatchFetch(
        'http://localhost:8787/document/test-doc/metadata',
        {
          headers: {
            Authorization: 'Bearer ' + token,
            Origin: origin,
          },
        }
      );

      // CORS should block the request or not set Access-Control-Allow-Origin
      const allowedOrigin = response.headers.get('Access-Control-Allow-Origin');
      expect(allowedOrigin).not.toBe(origin);
    }
  });

  test('should allow all HTTP methods for whitelisted origins', async () => {
    const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
    const origin = 'https://dev.macro.com';

    for (const method of methods) {
      const response = await mf.dispatchFetch(
        'http://localhost:8787/document/test-doc/metadata',
        {
          method: 'OPTIONS',
          headers: {
            Origin: origin,
            'Access-Control-Request-Method': method,
          },
        }
      );

      expect(response.status).toBe(200);
      const allowedMethods = response.headers.get(
        'Access-Control-Allow-Methods'
      );
      expect(allowedMethods).toContain(method);
    }
  });

  test('should allow required headers for API requests', async () => {
    const response = await mf.dispatchFetch(
      'http://localhost:8787/document/test-doc/metadata',
      {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://dev.macro.com',
          'Access-Control-Request-Method': 'GET',
          'Access-Control-Request-Headers': 'authorization',
        },
      }
    );

    expect(response.status).toBe(200);
    const allowedHeaders = response.headers.get('Access-Control-Allow-Headers');
    expect(allowedHeaders).toContain('authorization');
    expect(allowedHeaders).toContain('content-type');
  });

  test('should work with actual API requests after CORS validation', async () => {
    // Create a document first
    const user = await createTestUser(mf, 'cors-test-doc');
    user.makeChange('CORS test content');

    await new Promise((resolve) => setTimeout(resolve, 100));

    const token = getTokenForDocument('cors-test-doc', 'test-user', 'owner');

    // Make actual API request with CORS headers
    const response = await mf.dispatchFetch(
      'http://localhost:8787/document/cors-test-doc/metadata',
      {
        headers: {
          Authorization: 'Bearer ' + token,
          Origin: 'https://dev.macro.com',
          'Content-Type': 'application/json',
        },
      }
    );

    expect(response.status).toBe(200);

    // Verify both API response and CORS headers
    const metadata = await response.json();
    expect(metadata.id).toBe('cors-test-doc');

    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://dev.macro.com'
    );
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBe(
      'true'
    );

    user.connection.getWebSocket().close();
  });

  test('should handle mobile app origins (Capacitor)', async () => {
    const token = getTokenForDocument('test-doc', 'test-user', 'owner');

    const response = await mf.dispatchFetch(
      'http://localhost:8787/document/test-doc/metadata',
      {
        headers: {
          Authorization: 'Bearer ' + token,
          Origin: 'capacitor://localhost',
        },
      }
    );

    // Should allow Capacitor origin
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      'capacitor://localhost'
    );
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBe(
      'true'
    );
  });

  test('should handle requests without Origin header', async () => {
    const token = getTokenForDocument('test-doc', 'test-user', 'owner');

    const response = await mf.dispatchFetch(
      'http://localhost:8787/document/test-doc/metadata',
      {
        headers: {
          Authorization: 'Bearer ' + token,
          // No Origin header
        },
      }
    );

    // Should work for same-origin requests (no Origin header)
    expect([200, 404]).toContain(response.status);
  });
});
