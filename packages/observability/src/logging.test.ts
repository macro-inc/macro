// @vitest-environment jsdom
import { context, ROOT_CONTEXT } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import { resourceFromAttributes } from '@opentelemetry/resources';
import type { InMemoryLogRecordExporter } from '@opentelemetry/sdk-logs';
import { afterEach, expect, test, vi } from 'vitest';
import { Logging } from './logging';
import { suppressUserId } from './privacy';
import { ZoneContextManager } from './zone';

const exporters: InMemoryLogRecordExporter[] = [];
vi.mock('@opentelemetry/exporter-logs-otlp-http', async () => {
  const { InMemoryLogRecordExporter } = await import('@opentelemetry/sdk-logs');
  return {
    OTLPLogExporter: class extends InMemoryLogRecordExporter {
      constructor() {
        super();
        exporters.push(this);
      }
    },
  };
});

afterEach(() => {
  logs.disable();
  context.disable();
});

test('the production log provider suppresses identity only in anonymous contexts', async () => {
  context.setGlobalContextManager(new ZoneContextManager().enable());
  const logging = new Logging();
  logging.init(
    {
      serviceName: 'test',
      environment: 'test',
      enabled: async () => true,
      logsUrl: 'http://localhost/v1/logs',
    },
    resourceFromAttributes({}),
    () => 'private-user'
  );

  logging.warn('regular');
  context.with(suppressUserId(ROOT_CONTEXT), () => logging.warn('anonymous'));
  await logging.flush();

  const records = exporters[0].getFinishedLogRecords();
  expect(records[0].attributes['usr.id']).toBe('private-user');
  expect(records[1].attributes).not.toHaveProperty('usr.id');
  await logging.shutdown();
});
