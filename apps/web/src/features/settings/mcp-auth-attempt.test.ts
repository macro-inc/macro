import { afterEach, describe, expect, it } from 'vitest';
import {
  mcpAuthAttemptKey,
  readMcpAuthAttempted,
  writeMcpAuthAttempted,
} from './mcp-auth-attempt';

afterEach(() => {
  localStorage.clear();
});

describe('mcpAuthAttemptKey', () => {
  it('drops query strings so tokens are not stored in the key', () => {
    expect(mcpAuthAttemptKey('https://hooks.example/mcp?token=secret')).toBe(
      'mcp:auth-attempted:https://hooks.example/mcp'
    );
  });
});

describe('mcp auth attempt storage', () => {
  it('treats the same path with different query as one server', () => {
    writeMcpAuthAttempted('https://hooks.example/mcp?token=a', true);
    expect(readMcpAuthAttempted('https://hooks.example/mcp?token=b')).toBe(
      true
    );
  });
});
