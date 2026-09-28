import type { EntityLoadError } from '@core/component/EntityLoadGate';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal, onCleanup } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import {
  EmailThreadLoadGate,
  type EmailThreadLoadGateProps,
} from './EmailThreadLoadGate';

vi.mock('@notifications', () => ({ EmailDebouncedReadMarker: () => null }));
vi.mock('@core/mobile/native-network-status', () => ({
  nativeNetworkStatus: () => 'online',
}));
vi.mock('@core/component/AccessErrorViews/NotFound', () => ({
  default: () => <div>Not found</div>,
}));
vi.mock('@core/component/LoadingBlock', () => ({
  LoadingBlock: () => <div>Loading</div>,
}));
afterEach(cleanup);

it('retains the mounted composer during identity revalidation but respects server deletion', () => {
  const [data, setData] = createSignal<string>();
  const [pending, setPending] = createSignal(true);
  const [error, setError] = createSignal<EntityLoadError>();
  const unmounted = vi.fn();
  const Composer = () => {
    onCleanup(unmounted);
    return <input aria-label="Draft body" />;
  };
  render(() => (
    <EmailThreadLoadGate
      result={{ data, error, isPending: pending }}
      // The read marker is mocked; this test exercises the real load gate.
      notificationSource={
        {} as EmailThreadLoadGateProps<string>['notificationSource']
      }
      threadId="local-thread"
      onRetry={() => {}}
    >
      <Composer />
    </EmailThreadLoadGate>
  ));
  expect(screen.queryByRole('textbox')).toBeNull();
  setData('local-thread');
  setPending(false);
  const editor = screen.getByRole('textbox') as HTMLInputElement;
  editor.value = 'Keep unsaved text';
  editor.focus();
  setPending(true);
  expect(screen.getByRole('textbox')).toBe(editor);
  setData('server-thread');
  setPending(false);
  expect(screen.getByRole('textbox')).toBe(editor);
  expect(editor.value).toBe('Keep unsaved text');
  expect(document.activeElement).toBe(editor);
  expect(unmounted).not.toHaveBeenCalled();
  setError('NOT_FOUND');
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.getByText('Not found')).toBeTruthy();
  expect(unmounted).toHaveBeenCalledOnce();
});
