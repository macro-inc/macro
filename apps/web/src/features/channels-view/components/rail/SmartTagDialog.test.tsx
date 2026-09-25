import { ImperativeDialogHost } from '@app/components/ui/components/ImperativeDialog';
import { queryClient } from '@queries/client';
import type { SmartTagPreview } from '@service-storage/generated/schemas/smartTagPreview';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { QueryClientProvider } from '@tanstack/solid-query';
import { type Ok, ok } from 'neverthrow';
import type { ComponentProps, ParentProps } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promptSmartTag } from './SmartTagDialog';

const fetchPreview = vi.hoisted(() => vi.fn());
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: true }),
}));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: { channelLabels: { preview: fetchPreview } },
}));
vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return {
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: false } },
    }),
  };
});
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('@ui', async () => ({
  ...(await import('@app/components/ui/components/ImperativeDialog')),
  ...(await import('@app/components/ui/components/Dialog')),
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
  Layer: (props: ParentProps) => props.children,
  Surface: (props: ParentProps) => <div>{props.children}</div>,
  Input: (props: ComponentProps<'input'>) => <input {...props} />,
  Button: (props: ComponentProps<'button'>) => (
    <button type={props.type} disabled={props.disabled} onClick={props.onClick}>
      {props.children}
    </button>
  ),
}));

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  fetchPreview.mockReset();
  render(() => (
    <QueryClientProvider client={queryClient}>
      <ImperativeDialogHost />
    </QueryClientProvider>
  ));
});
afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.unstubAllGlobals();
});
const input = (label: string, value: string) =>
  fireEvent.input(screen.getByRole('textbox', { name: label }), {
    target: { value },
  });

describe('smart label dialog', () => {
  it('previews matches as the pattern changes, with bounded results and an overflow count', async () => {
    fetchPreview.mockImplementation(async (rule) =>
      ok(
        rule.contains === 'support'
          ? {
              channels: Array.from({ length: 5 }, (_, index) => ({
                id: `${index}`,
                name: `Support ${index}`,
              })),
              totalCount: 12,
            }
          : { channels: [{ id: 'sales', name: 'Sales team' }], totalCount: 1 }
      )
    );
    const onConfirm = vi.fn(async () => {});
    const result = promptSmartTag({ scopeDescription: 'Private', onConfirm });
    expect(fetchPreview).not.toHaveBeenCalled();
    input('Label name', 'Support');
    input('Name contains', 'support');
    await screen.findByText('+7 more channels matched');
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    input('Name contains', 'sales');
    await screen.findByText('Sales team');
    expect(screen.queryByText('Support 0')).toBeNull();
    expect(screen.queryByText('+7 more channels matched')).toBeNull();
    input('Name contains', '');
    expect(
      screen.queryByRole('region', { name: 'Matched channels' })
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await result;
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('ignores an old preview response after the user changes the pattern', async () => {
    let resolveFirst!: (value: Ok<SmartTagPreview, unknown>) => void;
    fetchPreview
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          })
      )
      .mockResolvedValueOnce(
        ok({ channels: [{ id: 'b', name: 'Latest match' }], totalCount: 1 })
      );
    const result = promptSmartTag({
      scopeDescription: 'Private',
      onConfirm: async () => {},
    });
    input('Name contains', 'first');
    await waitFor(() => expect(fetchPreview).toHaveBeenCalledTimes(1));
    input('Name contains', 'second');
    await screen.findByText('Latest match');
    resolveFirst(
      ok({ channels: [{ id: 'a', name: 'Stale match' }], totalCount: 1 })
    );
    await waitFor(() => expect(screen.queryByText('Stale match')).toBeNull());
    expect(screen.getByText('Latest match')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await result;
  });

  it('allows a rule-only edit, retains both fields on failure, and waits for the successful retry', async () => {
    fetchPreview.mockResolvedValue(ok({ channels: [], totalCount: 0 }));
    let finish!: () => void;
    const onConfirm = vi
      .fn()
      .mockRejectedValueOnce(new Error('Could not save'))
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          })
      );
    const result = promptSmartTag({
      scopeDescription: 'Shared',
      initial: {
        name: 'Support',
        rule: { attribute: 'name', contains: 'old' },
      },
      onConfirm,
    });
    input('Name contains', ' new ');
    fireEvent.click(screen.getByRole('button', { name: 'Save smart label' }));
    await screen.findByRole('alert');
    expect(
      (screen.getByRole('textbox', { name: 'Label name' }) as HTMLInputElement)
        .value
    ).toBe('Support');
    expect(
      (
        screen.getByRole('textbox', {
          name: 'Name contains',
        }) as HTMLInputElement
      ).value
    ).toBe(' new ');
    fireEvent.click(screen.getByRole('button', { name: 'Save smart label' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(onConfirm).toHaveBeenLastCalledWith('Support', {
      attribute: 'name',
      contains: 'new',
    });
    finish();
    await result;
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
