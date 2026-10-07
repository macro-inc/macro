import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FormAccessArgs } from './types';

let enabled = true;
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled }),
}));
vi.mock('@queries/storage/form-tool-review', () => ({
  useFormAccessReviewQuery: () => ({
    isSuccess: false,
    isError: true,
    refetch: vi.fn(),
  }),
}));
vi.mock('@queries/channel/channels', () => ({
  useListChannelsQuery: () => ({ isSuccess: false }),
}));
vi.mock('@app/features/block-form/queries/booking-sources', () => ({
  createBookingEventSource: () => ({ value: () => undefined }),
}));
vi.mock('@app/features/scheduling/scheduling', () => ({
  schedulingLink: () => '/unused',
}));

import { FormAccessReview } from './AccessReview';

const args: FormAccessArgs = {
  formId: '0199bfee-1000-7000-8000-000000000002',
  baseRevision: '0199bfee-1000-7000-8000-000000000003',
  draft: {
    audience: 'public',
    status: 'open',
    closesAt: null,
    tallyVisible: false,
    channelGrants: [],
  },
};
afterEach(() => {
  cleanup();
  enabled = true;
});
describe('unavailable Forms reviews', () => {
  it.each([true, false])(
    'can decline when the form is missing or Forms enabled=%s',
    async (flag) => {
      enabled = flag;
      const reject = vi.fn(async () => true);
      const execute = vi.fn(async () => true);
      render(() => (
        <FormAccessReview
          initialData={args}
          sink={{
            canAct: () => true,
            lockedNotice: () => undefined,
            onExecute: execute,
            onReject: reject,
          }}
        />
      ));
      expect(screen.queryByRole('button', { name: 'Save sharing' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Cancel review' }));
      await waitFor(() => expect(reject).toHaveBeenCalledOnce());
      expect(execute).not.toHaveBeenCalled();
    }
  );
});
