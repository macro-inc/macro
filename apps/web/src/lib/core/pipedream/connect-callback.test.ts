import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearPipedreamCallbacks,
  handlePipedreamCallback,
  PIPEDREAM_CALLBACK_PATH,
  registerPipedreamCallback,
} from './connect-callback';

afterEach(clearPipedreamCallbacks);

describe('native Pipedream return', () => {
  it('accepts a matching success exactly once and leaves other attempts pending', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { state } = registerPipedreamCallback(first);
    registerPipedreamCallback(second);
    const query = `state=${state}&outcome=success&account_id=apn_test`;
    expect(handlePipedreamCallback('/settings', query)).toBe(false);
    handlePipedreamCallback(
      PIPEDREAM_CALLBACK_PATH,
      query.replace(state, 'foreign')
    );
    handlePipedreamCallback(
      PIPEDREAM_CALLBACK_PATH,
      `state=${state}&outcome=success`
    );
    expect(first).not.toHaveBeenCalled();
    expect(handlePipedreamCallback(PIPEDREAM_CALLBACK_PATH, query)).toBe(true);
    handlePipedreamCallback(PIPEDREAM_CALLBACK_PATH, query);
    expect(first).toHaveBeenCalledExactlyOnceWith({
      type: 'success',
      accountId: 'apn_test',
    });
    expect(second).not.toHaveBeenCalled();
  });

  it('consumes canceled and expired callbacks without accepting late success', () => {
    const onEvent = vi.fn();
    const { state, remove } = registerPipedreamCallback(onEvent);
    remove();
    expect(
      handlePipedreamCallback(
        PIPEDREAM_CALLBACK_PATH,
        `state=${state}&outcome=success&account_id=apn_test`
      )
    ).toBe(true);
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('closes pending flows on logout and ignores their eventual return', () => {
    const onEvent = vi.fn();
    const { state } = registerPipedreamCallback(onEvent);
    clearPipedreamCallbacks();
    handlePipedreamCallback(
      PIPEDREAM_CALLBACK_PATH,
      `state=${state}&outcome=success&account_id=apn_test`
    );
    expect(onEvent).toHaveBeenCalledExactlyOnceWith({ type: 'close' });
  });
});
