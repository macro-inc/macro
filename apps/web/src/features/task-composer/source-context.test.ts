import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import { afterEach, expect, it, vi } from 'vitest';
import { taskSourceComposerContext } from './source-context';

const flag = vi.hoisted(() => ({ enabled: true }));
vi.mock('@core/constant/featureFlags', () => ({
  enableTaskSourceProperty: {},
  isFeatureEnabled: () => flag.enabled,
}));
afterEach(() => {
  flag.enabled = true;
});

it('captures an exact message independently from the originating action data', () => {
  const source = {
    entity_type: 'CHANNEL' as const,
    entity_id: 'channel',
    specific_message_id: 'reply',
  };
  const context = taskSourceComposerContext(source);
  source.specific_message_id = 'later-message';
  expect(context?.initialPropertyValues?.[SYSTEM_PROPERTY_IDS.SOURCE]).toEqual({
    valueType: 'ENTITY',
    refs: [
      {
        entity_type: 'CHANNEL',
        entity_id: 'channel',
        specific_message_id: 'reply',
      },
    ],
  });
  expect(context?.visiblePropertyIds).toContain(SYSTEM_PROPERTY_IDS.SOURCE);
  expect(context?.key).not.toBe(taskSourceComposerContext(source)?.key);
});

it('takes the flag snapshot when invoked, leaving an open preset unchanged', () => {
  flag.enabled = false;
  const source = { entity_type: 'THREAD' as const, entity_id: 'thread' };
  expect(taskSourceComposerContext(source)).toBeUndefined();
  flag.enabled = true;
  const context = taskSourceComposerContext(source);
  flag.enabled = false;
  expect(context?.initialPropertyValues?.[SYSTEM_PROPERTY_IDS.SOURCE]).toEqual({
    valueType: 'ENTITY',
    refs: [source],
  });
  expect(taskSourceComposerContext(source)).toBeUndefined();
});
