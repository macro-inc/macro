import { describe, expect, it } from 'vitest';
import {
  guardResponseBody,
  prepareResponseObservers,
  registerResponseObserver,
} from './response-observers';

describe('response permission guards', () => {
  it('awaits source capture before the caller dispatches the request', async () => {
    let finish!: () => void;
    let captured = false;
    const stop = registerResponseObserver(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      captured = true;
      return (response) => response;
    });
    const preparing = prepareResponseObservers('https://example.com');
    expect(captured).toBe(false);
    finish();
    await preparing;
    expect(captured).toBe(true);
    stop();
  });
  it('rejects a response whose body finishes after revocation, including clones', async () => {
    let current = true;
    const guard = async () => {
      if (!current) throw new Error('revoked');
    };
    const response = guardResponseBody(
      new Response('{"name":"record"}'),
      guard
    );
    const clone = response.clone();
    current = false;
    await expect(response.text()).rejects.toThrow('revoked');
    await expect(clone.json()).rejects.toThrow('revoked');
  });
});
