import {
  createSignal,
  onCleanup,
  onMount,
  type ParentProps,
  Show,
} from 'solid-js';
import { render } from 'solid-js/web';
import { describe, expect, it, vi } from 'vitest';
import { EmailThreadLoadGate } from './EmailThreadLoadGate';

const mounts = vi.hoisted(() => ({
  ids: [] as string[],
  releases: [] as string[],
}));
vi.mock('@core/component/EntityLoadGate', () => ({
  EntityLoadGate: (
    props: ParentProps<{ result: { isPending(): boolean } }>
  ) => <Show when={!props.result.isPending()}>{props.children}</Show>,
}));
vi.mock('@notifications', () => ({
  EmailDebouncedReadMarker: (props: { threadId: string }) => {
    const id = props.threadId;
    onMount(() => mounts.ids.push(id));
    onCleanup(() => mounts.releases.push(id));
    return null;
  },
}));

describe('email read marker ownership', () => {
  it('restarts read marking for cached navigation without remounting the body', () => {
    const [id, setId] = createSignal('a');
    const [pending, setPending] = createSignal(false);
    const host = document.createElement('div');
    const dispose = render(
      () => (
        <EmailThreadLoadGate
          threadId={id()}
          notificationSource={{} as never}
          result={{
            data: () => ({}),
            error: () => undefined,
            isPending: pending,
          }}
          onRetry={() => {}}
        >
          <div data-body="true" />
        </EmailThreadLoadGate>
      ),
      host
    );
    try {
      const body = host.querySelector('[data-body]');
      expect(mounts.ids).toEqual(['a']);
      setId('b');
      expect(mounts.ids).toEqual(['a', 'b']);
      expect(mounts.releases).toEqual(['a']);
      expect(host.querySelector('[data-body]')).toBe(body);
      setId('b');
      expect(mounts.ids).toHaveLength(2);
      setPending(true);
      expect(mounts.releases).toEqual(['a', 'b']);
    } finally {
      dispose();
    }
  });
});
