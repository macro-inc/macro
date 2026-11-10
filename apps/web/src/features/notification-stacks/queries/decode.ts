import type { NotificationStack as WireStack } from '@service-notification/generated/schemas/notificationStack';
import type { NotificationStackRule as WireRule } from '@service-notification/generated/schemas/notificationStackRule';
import type { Stack, StackRule } from '../core/stack';

/** A wire rule with every condition present; the server may leave lists out. */
const toRule = (rule: WireRule): StackRule => ({
  sources: rule.sources ?? [],
  channelTypes: rule.channelTypes ?? [],
  kinds: rule.kinds ?? [],
  senders: rule.senders ?? [],
});

export const toStack = (stack: WireStack): Stack => ({
  id: stack.id,
  name: stack.name,
  capture: stack.capture.map(toRule),
  release: stack.release.map(toRule),
  enabled: stack.enabled,
});

export const toWireRule = (rule: StackRule): WireRule => ({
  sources: [...rule.sources],
  channelTypes: [...rule.channelTypes],
  kinds: [...rule.kinds],
  senders: [...rule.senders],
});
