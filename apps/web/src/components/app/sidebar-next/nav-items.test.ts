import { describe, expect, it } from 'vitest';
import { visibleNavItems } from './nav-items';

describe('sidebar rail navigation items', () => {
  it('reaches reminders through Email rather than a rail button of their own', () => {
    const items = visibleNavItems({ showCalendar: true, showCustomers: true });

    expect(items.some((item) => item.id === 'reminders')).toBe(false);
    expect(items.find((item) => item.id === 'mail')).toMatchObject({
      label: 'Email',
      href: '/mail',
    });
  });

  it('gates the Calendar and Customers buttons', () => {
    const ids = visibleNavItems({
      showCalendar: false,
      showCustomers: false,
    }).map((item) => item.id);

    expect(ids).not.toContain('calendar');
    expect(ids).not.toContain('companies');
    expect(ids).toEqual(
      expect.arrayContaining(['home', 'documents', 'mail', 'channels'])
    );
  });
});
