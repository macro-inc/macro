import { cleanup, render } from '@solidjs/testing-library';
import { createSignal, Show } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { notifyElementOnMount } from '../../Thread/message-element-lifecycle';
import { createUnreadDestinationRegistry } from '../create-unread-destination-registry';

afterEach(cleanup);

it('registers connected destinations and publishes mount/unmount changes even without resizing', () => {
  const onChange = vi.fn();
  const registry = createUnreadDestinationRegistry(onChange);
  const [expanded, setExpanded] = createSignal(false);
  const mounted = vi.fn((id: string, element: HTMLElement) => {
    expect(element.isConnected).toBe(true);
    return registry.registerDisclosure(id, element);
  });
  const view = render(() => (
    <Show
      when={!expanded()}
      fallback={
        <div
          style={{ height: '32px' }}
          ref={(element) =>
            notifyElementOnMount(registry.registerMessage, 'reply', element)
          }
        >
          Reply
        </div>
      }
    >
      <button
        style={{ height: '32px' }}
        ref={(element) => notifyElementOnMount(mounted, 'thread', element)}
      >
        Expand
      </button>
    </Show>
  ));
  expect(mounted).toHaveBeenCalledOnce();
  expect(registry.elements.disclosures.get('thread')).toBe(
    view.getByText('Expand')
  );
  expect(onChange).toHaveBeenCalledTimes(1);
  setExpanded(true);
  expect(registry.elements.disclosures.has('thread')).toBe(false);
  expect(registry.elements.messages.get('reply')).toBe(view.getByText('Reply'));
  expect(onChange).toHaveBeenCalledTimes(3);
  setExpanded(false);
  expect(registry.elements.messages.has('reply')).toBe(false);
  expect(registry.elements.disclosures.get('thread')).toBe(
    view.getByText('Expand')
  );
  view.unmount();
  expect(registry.elements.messages.size).toBe(0);
  expect(registry.elements.disclosures.size).toBe(0);
});

it('does not let a stale row cleanup unregister its replacement', () => {
  const onChange = vi.fn();
  const registry = createUnreadDestinationRegistry(onChange);
  const first = document.createElement('div');
  const replacement = document.createElement('div');
  const removeFirst = registry.registerMessage('reply', first);
  const removeReplacement = registry.registerMessage('reply', replacement);
  onChange.mockClear();
  removeFirst();
  expect(registry.elements.messages.get('reply')).toBe(replacement);
  expect(onChange).not.toHaveBeenCalled();
  removeReplacement();
  expect(registry.elements.messages.has('reply')).toBe(false);
  expect(onChange).toHaveBeenCalledOnce();
});
