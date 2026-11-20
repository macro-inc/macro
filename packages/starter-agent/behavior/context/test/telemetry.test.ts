import { expect, test } from 'bun:test';
import {
  agentTelemetryId,
  telemetryEnvironment,
  tracesHeaders,
  tracesUrl,
} from '../telemetry.ts';

test('the traces URL comes from the standard OTel variables, and is absent when neither is set', () => {
  expect(tracesUrl({})).toBeUndefined();
  expect(tracesUrl({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://otel:4318/' })).toBe(
    'http://otel:4318/v1/traces'
  );
  expect(
    tracesUrl({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://otel:4318',
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://traces:4318/v1/traces',
    })
  ).toBe('http://traces:4318/v1/traces');
});

test("a child gets only where to export and the computer's header, never anything else of this process", () => {
  expect(
    telemetryEnvironment({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://otel:4318',
      OTEL_EXPORTER_OTLP_HEADERS:
        'authorization=Bearer%20secret,x-macro-computer-id=c1',
      MACRO_API_KEY: 'mak_secret',
      OTEL_DEPLOYMENT_ENVIRONMENT: 'local',
    })
  ).toEqual({
    OTEL_EXPORTER_OTLP_ENDPOINT: 'http://otel:4318',
    OTEL_EXPORTER_OTLP_HEADERS: 'x-macro-computer-id=c1',
    OTEL_DEPLOYMENT_ENVIRONMENT: 'local',
  });
});

test("the agent's account, an email, is recorded only as an opaque id", () => {
  const id = agentTelemetryId('macro|sam@agents.example.com');
  expect(id).toMatch(/^[0-9a-f]{16}$/);
  expect(id).not.toContain('sam');
});

test('the export names the computer from the standard headers variable, skipping malformed entries', () => {
  expect(tracesHeaders({})).toEqual({});
  expect(
    tracesHeaders({
      OTEL_EXPORTER_OTLP_HEADERS:
        'X-Macro-Computer-Id=01900000-0000-7000-8000-000000000001, a=b%20c,broken,%=x,bad=%E0',
    })
  ).toEqual({
    'x-macro-computer-id': '01900000-0000-7000-8000-000000000001',
    a: 'b c',
    '%': 'x',
  });
});
