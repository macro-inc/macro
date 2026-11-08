import { describe, expect, test } from 'bun:test';
import { lexicalRouteModesFromBundle } from './lexical-route-modes';

describe('Lambda route policy projection', () => {
  test.each([
    '',
    'markdown=http,snapshot=http,composers=http,html=http',
    'snapshot=in_process,composers=shadow',
  ])('preserves valid map %j without projecting other settings', (modes) => {
    expect(
      lexicalRouteModesFromBundle(
        JSON.stringify({
          LEXICAL_ROUTE_MODES: modes,
          INTERNAL_API_KEY: 'private-config-sentinel',
        })
      )
    ).toBe(modes);
  });

  test.each([
    'markdown=http,markdown=shadow',
    'gate=shadow',
    'markdown=remote',
    'markdown=http,',
    ' markdown=http',
    'html=HTTP',
    'html=http\n',
    'private-config-sentinel',
  ])('rejects malformed map %j without including it in diagnostics', (modes) => {
    const invoke = () =>
      lexicalRouteModesFromBundle(
        JSON.stringify({ LEXICAL_ROUTE_MODES: modes })
      );
    expect(invoke).toThrow('Invalid LEXICAL_ROUTE_MODES in service config');
    try {
      invoke();
    } catch (error) {
      expect(String(error)).not.toContain(modes);
    }
  });

  test.each([
    'private-config-sentinel',
    '{}',
    'null',
    '[]',
    '{"LEXICAL_ROUTE_MODES":true,"INTERNAL_API_KEY":"private-config-sentinel"}',
  ])('rejects missing or corrupt config without leaking the bundle', (bundle) => {
    const invoke = () => lexicalRouteModesFromBundle(bundle);
    expect(invoke).toThrow('Invalid LEXICAL_ROUTE_MODES in service config');
    try {
      invoke();
    } catch (error) {
      expect(String(error)).not.toContain('private-config-sentinel');
    }
  });
});
