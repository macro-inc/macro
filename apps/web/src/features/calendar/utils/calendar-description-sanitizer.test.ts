// @vitest-environment jsdom
import { expect, test } from 'vitest';
import {
  calendarDescriptionPreviewHtml,
  sanitizeCalendarDescription,
} from './calendar-description-sanitizer';

test('preview paragraph markers stay out of portable descriptions', () => {
  const raw =
    '<p class="untrusted" onclick="alert(1)">first</p><p>second</p><ul><li><p>nested</p><p>next</p></li></ul><p>after list</p>';
  expect(calendarDescriptionPreviewHtml(raw)).toBe(
    '<p class="calendar-description-paragraph">first</p><p class="calendar-description-paragraph">second</p><ul><li><p class="calendar-description-paragraph">nested</p><p class="calendar-description-paragraph">next</p></li></ul><p class="calendar-description-paragraph">after list</p>'
  );
  expect(sanitizeCalendarDescription(raw)).toBe(
    '<p>first</p><p>second</p><ul><li><p>nested</p><p>next</p></li></ul><p>after list</p>'
  );
});

test('preview handles empty and plain descriptions through the sanitizer', () => {
  expect(calendarDescriptionPreviewHtml('   ')).toBe('');
  expect(calendarDescriptionPreviewHtml('first\nsecond')).toBe(
    '<p class="calendar-description-paragraph">first<br>second</p>'
  );
});
