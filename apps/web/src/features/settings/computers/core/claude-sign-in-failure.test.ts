import { ThrownResultError } from '@core/util/result';
import { describe, expect, it } from 'vitest';
import {
  claudeSignInFailure,
  claudeSignInRecovery,
} from './claude-sign-in-failure';

const thrown = (code: string) =>
  new ThrownResultError([{ code, message: code }]);

describe('claudeSignInFailure', () => {
  it('reads the code the service client put on the failure', () => {
    expect(claudeSignInFailure(thrown('CLAUDE_SIGN_IN_EXPIRED'))).toBe(
      'expired'
    );
    expect(claudeSignInFailure(thrown('CLAUDE_INVALID_CODE'))).toBe(
      'invalid_code'
    );
    expect(claudeSignInFailure(thrown('CLAUDE_MALFORMED_CODE'))).toBe(
      'malformed_code'
    );
    expect(claudeSignInFailure(thrown('CLAUDE_COMPUTER_UNREACHABLE'))).toBe(
      'unreachable'
    );
    expect(claudeSignInFailure(thrown('CLAUDE_COMPUTER_BUSY'))).toBe('busy');
    expect(claudeSignInFailure(thrown('CLAUDE_TIMEOUT'))).toBe('timeout');
    expect(claudeSignInFailure(thrown('SERVER_ERROR'))).toBe('failed');
    expect(claudeSignInFailure(new Error('network'))).toBe('failed');
  });
});

describe('claudeSignInRecovery', () => {
  it('retries any failure to start', () => {
    expect(claudeSignInRecovery('start', 'unreachable')).toBe('retry');
    expect(claudeSignInRecovery('start', 'failed')).toBe('retry');
  });

  it('needs a new link once the computer has ended the sign-in', () => {
    expect(claudeSignInRecovery('complete', 'expired')).toBe('new_link');
    expect(claudeSignInRecovery('complete', 'invalid_code')).toBe('new_link');
    expect(claudeSignInRecovery('complete', 'failed')).toBe('new_link');
  });

  it('lets the code be pasted again while the sign-in still waits', () => {
    expect(claudeSignInRecovery('complete', 'malformed_code')).toBe('repaste');
    expect(claudeSignInRecovery('complete', 'busy')).toBe('repaste');
    expect(claudeSignInRecovery('complete', 'unreachable')).toBe('repaste');
    expect(claudeSignInRecovery('complete', 'timeout')).toBe('repaste');
  });
});
