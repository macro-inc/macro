import { describe, expect, it } from 'vitest';
import {
  guardResponseBody,
  prepareResponseObservers,
  registerResponseObserver,
} from './response-observers';

describe('response permission guards', () => {
  it('captures a generation synchronously before the caller dispatches', () => {
    let captured = false;
    const stop = registerResponseObserver(() => {
      captured = true;
      return (response) => response;
    });
    const guard = prepareResponseObservers('https://example.com');
    expect(captured).toBe(true);
    expect(guard).not.toBeInstanceOf(Promise);
    stop();
  });
  it('rejects a response whose body finishes after revocation, including clones', async () => {
    let current = true;
    const guard = () => {
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
