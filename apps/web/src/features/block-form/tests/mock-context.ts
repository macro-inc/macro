import { okAsync } from 'neverthrow';
import { createSignal } from 'solid-js';
import type { FormContext, FormDetailSource } from '../context/form-context';
import type { FormDetail } from '../core/form-model';

/** What a mocked context was asked to do, in order. */
export type MockFormCalls = {
  notices: string[];
};

/**
 * In-memory capabilities for views. The form detail is a signal the test
 * can replace.
 */
export function createMockFormContext(options: {
  detail: FormDetail;
  overrides?: Partial<FormContext>;
}) {
  const [detail, setDetail] = createSignal<FormDetail | undefined>(
    options.detail
  );
  const calls: MockFormCalls = {
    notices: [],
  };
  const source: FormDetailSource = {
    detail,
    failure: () => undefined,
    refetch: async () => true,
  };
  const context: FormContext = {
    createFormSource: () => source,
    updateMetadata: () => okAsync(undefined),
    trashForm: () => okAsync(undefined),
    confirm: async () => true,
    responses: {
      createSummary: () => ({
        value: () => ({
          submitted: 0,
          stopped: 0,
          stoppedBySection: [],
          rows: 0,
        }),
        failure: () => undefined,
      }),
    },
    notify: {
      success: (message) => calls.notices.push(`✓ ${message}`),
      failure: (message) => calls.notices.push(`✗ ${message}`),
    },
    ...options.overrides,
  };
  return { context, calls, setDetail, source };
}
