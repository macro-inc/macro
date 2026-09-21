import { describe, expect, it } from 'vitest';
import {
  reminderDetailComponentId,
  reminderDetailDestination,
  reminderDetailUrl,
  reminderIdFromDetailComponent,
} from './reminder-navigation';

describe('reminder detail destination', () => {
  it('uses one component identity for split opening, copied URLs, and reload', () => {
    const destination = reminderDetailDestination('reminder-1');
    const componentId = reminderDetailComponentId('reminder-1');

    expect(destination).toEqual({
      kind: 'reminder-detail',
      reminderId: 'reminder-1',
      content: { type: 'component', id: componentId },
    });
    expect(new URL(reminderDetailUrl('reminder-1')).pathname).toBe(
      `/app/component/${componentId}`
    );
    expect(reminderIdFromDetailComponent(componentId)).toBe('reminder-1');
  });

  it('rejects unrelated and empty component ids', () => {
    expect(reminderIdFromDetailComponent('reminders')).toBeUndefined();
    expect(reminderIdFromDetailComponent('reminder-view~')).toBeUndefined();
  });
});
