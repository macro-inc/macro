import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MonthGrid } from './MonthGrid';

const locale = vi.hoisted(() => ({ value: 'en-US' }));
vi.mock('@app/lib/i18n', () => ({
  formatLocale: () => locale.value,
  t: (key: string) => key,
}));
afterEach(cleanup);

describe('Month weekday headers', () => {
  it.each([
    {
      language: 'en-US',
      expected: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    },
    {
      language: 'fr-FR',
      expected: ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'],
    },
  ])(
    'uses localized short names at narrow widths: $language',
    ({ language, expected }) => {
      locale.value = language;
      const { container } = render(() => (
        <div style={{ width: '320px' }}>
          <MonthGrid
            weeks={[
              {
                days: Array.from({ length: 7 }, (_, i) => ({
                  date: new Date(2026, 10, 1 + i),
                  events: [],
                })),
                bars: [],
                hidden: [0, 0, 0, 0, 0, 0, 0],
              },
            ]}
            month={new Date(2026, 10, 1)}
            today={new Date(2026, 10, 1)}
            selected={undefined}
            timeFormat="24-hour"
            capacity={3}
            cardRef={() => {}}
            isSupported={() => true}
            onPick={() => {}}
          />
        </div>
      ));
      const headers = container.querySelectorAll(
        '.phone-month-weekdays > span'
      );
      expect(Array.from(headers, (header) => header.textContent)).toEqual(
        expected
      );
      expect(
        container.querySelector<HTMLElement>('.phone-month-weekdays')?.style
          .gridTemplateColumns
      ).toBe('repeat(7, minmax(0, 1fr))');
    }
  );
});
