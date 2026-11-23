import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { expect, it } from 'vitest';

const GRID_CSS = postcss.parse(
  readFileSync('src/features/calendar/calendar.css', 'utf8')
);
const PHONE_CSS = postcss.parse(
  readFileSync(
    'src/features/calendar-view/components/month/month-grid.css',
    'utf8'
  )
);

function declarations(selector: string, width: number, root = GRID_CSS) {
  const values = new Map<string, string>();
  root.walkRules((rule) => {
    if (rule.selector.replace(/\s+/g, ' ').trim() !== selector) return;
    const parent = rule.parent;
    if (parent?.type === 'atrule' && parent.name === 'container') {
      const max = parent.params.match(/max-width:\s*(\d+)px/);
      if (max && width > Number(max[1])) return;
    }
    rule.walkDecls((declaration) => {
      values.set(declaration.prop, declaration.value);
    });
  });
  return values;
}

it('scales desktop Month padding from the event container with a token floor and cap', () => {
  const content = declarations(
    '.calendar-view .fc .fc-event .calendar-event-content',
    320
  );
  expect(content.get('container-type')).toBe('inline-size');
  const padding = declarations(
    '.calendar-view .fc .calendar-month-event .calendar-event-content-layout',
    320
  ).get('padding-inline');
  const match = padding?.match(
    /^clamp\(calc\(var\(--spacing\) \/ (\d+)\), ([\d.]+)cqi, calc\(var\(--spacing\) \* ([\d.]+)\)\)$/
  );
  expect(match).not.toBeNull();
  if (!match) throw new Error('Missing token-based container padding');
  const spacing = 4;
  for (const [width, expected] of [
    [24, 2],
    [32, 2],
    [64, 4],
    [96, 6],
    [160, 6],
  ]) {
    const actual = Math.max(
      spacing / Number(match[1]),
      Math.min((width * Number(match[2])) / 100, spacing * Number(match[3]))
    );
    expect(actual).toBe(expected);
  }
});

it('scales phone padding from day-column width rather than viewport width', () => {
  expect(
    declarations('.phone-month-week', 320, PHONE_CSS).get('container-type')
  ).toBe('inline-size');
  expect(
    declarations('.phone-month-bar', 320, PHONE_CSS).get('padding-inline')
  ).toBe(
    'clamp(calc(var(--spacing) / 2), calc(6.25cqi / var(--phone-month-columns)), calc(var(--spacing) * 0.75))'
  );
  for (const [gridWidth, columns, expected] of [
    [224, 7, 2],
    [280, 7, 2.5],
    [280, 5, 3],
    [560, 7, 3],
  ]) {
    expect(Math.max(2, Math.min((gridWidth / columns) * 0.0625, 3))).toBe(
      expected
    );
  }
});

it('fits narrow header digits on the type scale and pairs accent foreground with the fill', () => {
  const selector = '.calendar-view .fc .fc-timegrid .calendar-day-header-date';
  expect(declarations(selector, 320).get('font-size')).toBe('var(--text-base)');
  expect(declarations(selector, 520).get('line-height')).toBe(
    'var(--text-base--line-height)'
  );
  expect(declarations(selector, 900).get('font-size')).toBe('var(--text-2xl)');
  expect(declarations(selector, 320).get('flex-shrink')).toBe('0');
  expect(declarations(selector, 320).get('min-width')).toBe('max-content');
  const selected = declarations(
    '.calendar-view .fc .fc-timegrid .calendar-day-header-date-selected',
    320
  );
  expect(selected.get('background')).toBe('var(--color-accent)');
  expect(selected.get('color')).toBe('var(--button-accent-ink)');
});
