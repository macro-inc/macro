import { fetchWithToken } from '@core/util/fetchWithToken';
import { Telemetry } from '@macro-inc/observability';
import { StackContextManager } from '@macro-inc/observability/web';
import { context, trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { err, ok } from 'neverthrow';
import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { storageServiceClient } from './client';

vi.mock('@core/util/fetchWithToken', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/util/fetchWithToken')>()),
  fetchWithToken: vi.fn(),
}));
const fetch = vi.mocked(fetchWithToken);
context.setGlobalContextManager(new StackContextManager().enable());
const exporter = new InMemorySpanExporter();
trace.setGlobalTracerProvider(
  new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  })
);
beforeAll(() =>
  Telemetry.init({
    serviceName: 'test',
    environment: 'test',
    enabled: async () => true,
  })
);
beforeEach(() => {
  fetch.mockReset();
  exporter.reset();
});

it('validates processing results after loading the PDF protocol', async () => {
  fetch.mockResolvedValueOnce(
    ok({ data: { result: JSON.stringify({ overlays: [] }) } })
  );
  const parsed = await storageServiceClient.getDocumentProcessingResult({
    documentId: 'document',
    type: 'PREPROCESS',
  });
  expect(parsed._unsafeUnwrap()).toEqual({ preprocess: { overlays: [] } });
  fetch.mockResolvedValueOnce(
    ok({ data: { result: JSON.stringify({ overlays: 3 }) } })
  );
  const invalid = await storageServiceClient.getJobProcessingResult({
    documentId: 'document',
    jobId: 'job',
    type: 'PREPROCESS',
  });
  expect(invalid._unsafeUnwrapErr()[0].code).toBe('INVALID_RESPONSE');
});

it('keeps save dispatch under its action across protocol loading', async () => {
  fetch.mockImplementation(async () => {
    Telemetry.span('pdf.dispatch').end();
    return err([{ code: 'NETWORK_ERROR', message: 'offline' }]);
  });
  const action = Telemetry.span('pdf.save');
  const pending = action.run(() =>
    storageServiceClient.pdfSave({
      documentId: 'document',
      sha: 'test-sha',
      modificationData: {
        highlights: {},
        bookmarks: [],
        placeables: [],
        pinnedTermsNames: [],
      },
    })
  );
  await pending;
  action.end();
  const dispatch = exporter
    .getFinishedSpans()
    .find((span) => span.name === 'pdf.dispatch');
  const root = exporter
    .getFinishedSpans()
    .find((span) => span.name === 'pdf.save');
  expect(dispatch?.parentSpanContext?.spanId).toBe(root?.spanContext().spanId);
  expect(dispatch).toBeDefined();
});
