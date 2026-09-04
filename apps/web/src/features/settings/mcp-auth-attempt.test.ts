import { afterEach, describe, expect, it } from 'vitest';
import {
  clearMcpAuthAttempts,
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

  it('drops leftover markers so a later account cannot read them', () => {
    writeMcpAuthAttempted('https://hooks.example/mcp', true);
    writeMcpAuthAttempted('https://other.example/mcp', true);
    localStorage.setItem('unrelated', 'keep');
    clearMcpAuthAttempts();
    expect(readMcpAuthAttempted('https://hooks.example/mcp')).toBe(false);
    expect(readMcpAuthAttempted('https://other.example/mcp')).toBe(false);
    expect(localStorage.getItem('unrelated')).toBe('keep');
  });
});
