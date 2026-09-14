import { afterEach, expect, test } from 'bun:test';
import { Macro } from '../src/macro';

const originalMacroEnv = process.env.MACRO_ENV;

afterEach(() => {
  if (originalMacroEnv === undefined) {
    delete process.env.MACRO_ENV;
  } else {
    process.env.MACRO_ENV = originalMacroEnv;
  }
});

test('uses production services when no environment is configured', () => {
  delete process.env.MACRO_ENV;

  const macro = new Macro({ token: 'test-token' });

  expect(macro._client.hosts.storage).toBe('https://gateway.macro.com/dss');
  expect(macro.webAppUrl).toBe('https://macro.com');
});
