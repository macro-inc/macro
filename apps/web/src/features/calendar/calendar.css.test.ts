import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const calendarStyles = readFileSync(
  `${import.meta.dirname}/calendar.css`,
  'utf8'
);

describe('calendar skeleton animation styles', () => {
  it('pauses only hidden pages when the pager wraps the calendar view', () => {
    const pauseRule = [
      ...calendarStyles.matchAll(/([^{}]+)\{\s*animation:\s*none;\s*\}/g),
    ].find((rule) => rule[1].includes('[data-calendar-loading-placeholder]'));
    expect(pauseRule).toBeDefined();
    const selector = pauseRule![1].replace(/\/\*[\s\S]*?\*\//g, '').trim();
    const container = document.createElement('div');
    container.innerHTML = `
      <div class="pager-page" aria-hidden="true">
        <div class="calendar-view"><div data-calendar-loading-placeholder="timed"></div></div>
      </div>
      <div class="pager-page" aria-hidden="false">
        <div class="calendar-view"><div data-calendar-loading-placeholder="timed"></div></div>
      </div>
    `;
    const [hiddenPage, activePage] = container.querySelectorAll('.pager-page');
    const [hiddenSkeleton, activeSkeleton] = container.querySelectorAll(
      '[data-calendar-loading-placeholder]'
    );
    expect(hiddenSkeleton.matches(selector)).toBe(true);
    expect(activeSkeleton.matches(selector)).toBe(false);
    hiddenPage.setAttribute('aria-hidden', 'false');
    activePage.setAttribute('aria-hidden', 'true');
    expect(hiddenSkeleton.matches(selector)).toBe(false);
    expect(activeSkeleton.matches(selector)).toBe(true);
  });
});
