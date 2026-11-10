import { createSignal } from 'solid-js';
import { vi } from 'vitest';
import type {
  NotificationStacksContext,
  StacksState,
} from '../context/notification-stacks-context';
import type { Stack, StackRule } from '../core/stack';

export const rule = (changes: Partial<StackRule> = {}): StackRule => ({
  sources: [],
  channelTypes: [],
  kinds: [],
  senders: [],
  ...changes,
});

/** A stack that captures channels named "support" and lets mentions through. */
export const supportStack = (changes: Partial<Stack> = {}): Stack => ({
  id: 'stack-support',
  name: 'Support channels',
  capture: [
    rule({ sources: [{ type: 'channelNameContains', text: 'support' }] }),
  ],
  release: [rule({ kinds: ['mention'] })],
  enabled: true,
  ...changes,
});

/** A stacks context over a list a test owns; every write is a spy. */
export function fakeStacksContext(initial: StacksState) {
  const [state, setState] = createSignal(initial);
  const stacks = {
    state,
    retry: vi.fn(),
    create: vi.fn(async (name: string) => supportStack({ id: 'new', name })),
    update: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    reorder: vi.fn(async () => {}),
  };
  const context: NotificationStacksContext = {
    stacks,
    EntityLabel: (props) => <span>{`${props.kind}:${props.id}`}</span>,
    EntityPicker: () => <div data-testid="entity-picker" />,
  };
  return { context, stacks, setState };
}
