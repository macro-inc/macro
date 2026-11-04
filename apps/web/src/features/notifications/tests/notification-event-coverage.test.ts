import type { NotificationType } from '@core/types';
import BellIcon from '@icon/system/regular/bell-simple.svg';
import { describe, expect, it } from 'vitest';
import { getNotificationIcon } from '../../entity/extractors-notification/notification-icon';
import { NOTIFICATION_LABEL_BY_TYPE } from '../notification-preview';

/**
 * Every `NotifEvent` tag, read from the generated notification-service
 * schemas rather than copied by hand: each variant's tag is its own
 * generated `NotifEventOneOf…Tag` constant.
 */
const tagModules = import.meta.glob<Record<string, Record<string, string>>>(
  '../../../lib/service-clients/service-notification/generated/schemas/notifEventOneOf*Tag.ts',
  { eager: true }
);
const generatedTags = Object.values(tagModules).flatMap((module) =>
  Object.values(module).flatMap((tag) => Object.values(tag))
);
// `call_started` is added to the generated tags by `NotificationType` itself.
const tags = [...new Set([...generatedTags, 'call_started'])];

function isNotificationType(tag: string): tag is NotificationType {
  return tag in NOTIFICATION_LABEL_BY_TYPE;
}

// Their ts-pattern matches end in a fallback, so a new or renamed tag would
// silently show the generic bell; only these use it on purpose.
const BELL_ON_PURPOSE = new Set<string>(['reminder']);

describe('notification event coverage', () => {
  it('reads every event tag from the generated schemas', () => {
    expect(generatedTags.length).toBe(Object.keys(tagModules).length);
    expect(tags.length).toBeGreaterThan(30);
  });

  it.each(tags)('%s has a preview label', (tag) => {
    expect(isNotificationType(tag)).toBe(true);
    if (!isNotificationType(tag)) return;
    expect(NOTIFICATION_LABEL_BY_TYPE[tag]).toMatch(/\S/);
  });

  it.each(tags)('%s has its own icon', (tag) => {
    if (!isNotificationType(tag)) throw new Error(`${tag} has no label`);
    const icon = getNotificationIcon(tag);
    expect(icon).toBeTruthy();
    if (!BELL_ON_PURPOSE.has(tag)) expect(icon).not.toBe(BellIcon);
  });

  it('shows external chat messages under External', () => {
    expect(NOTIFICATION_LABEL_BY_TYPE.external_chat_message).toBe('EXTERNAL');
  });
});
