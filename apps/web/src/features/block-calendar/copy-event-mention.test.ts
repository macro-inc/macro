import { beforeEach, describe, expect, it, vi } from 'vitest';
import { copyCalendarEventMentionTarget } from './copy-event-mention';

const writeClipboardData = vi.hoisted(() =>
  vi.fn(async (_data: Record<string, string | undefined>) => true)
);

vi.mock('@core/util/dataTransfer', () => ({ writeClipboardData }));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: vi.fn(), failure: vi.fn() },
}));

const written = () => writeClipboardData.mock.calls[0]?.[0];

describe('copyCalendarEventMentionTarget', () => {
  beforeEach(() => writeClipboardData.mockClear());

  it('writes a mention span an editor can import', async () => {
    await copyCalendarEventMentionTarget({
      eventId: 'event-1',
      title: 'Smart Macro Discussion',
    });

    const html = written()?.['text/html'];
    expect(html).toContain('data-document-mention="true"');
    expect(html).toContain('data-document-id="event-1"');
    expect(html).toContain('data-block-name="calendar"');
    expect(html).not.toContain('data-block-params');
  });

  it('pins the occurrence when one is given', async () => {
    await copyCalendarEventMentionTarget({
      eventId: 'event-1',
      title: 'Standup',
      occurrenceKey: '2026-08-21T18:00:00+00:00',
    });

    expect(written()?.['text/html']).toContain(
      `data-block-params="${JSON.stringify({ occurrenceKey: '2026-08-21T18:00:00+00:00' }).replaceAll('"', '&quot;')}"`
    );
  });

  // `importDOM` reads the title back off the attribute, so a title carrying
  // quotes or angle brackets has to survive the round trip intact.
  it('round-trips a title that could break the markup', async () => {
    const title = 'Q3 "<review>" & retro';
    await copyCalendarEventMentionTarget({ eventId: 'event-1', title });

    const html = written()?.['text/html'] ?? '';
    const span = new DOMParser()
      .parseFromString(html, 'text/html')
      .querySelector('span');
    expect(span?.getAttribute('data-document-name')).toBe(title);
    expect(span?.textContent).toBe(title);
  });

  it('falls back to a deep link for the plain flavor', async () => {
    await copyCalendarEventMentionTarget({
      eventId: 'event-1',
      title: 'Standup',
      occurrenceKey: '2026-08-21T18:00:00+00:00',
    });

    const plain = written()?.['text/plain'] ?? '';
    expect(plain).toContain('/app/calendar/');
    expect(plain).toContain('eventId=event-1');
    expect(plain).toContain(
      `occurrenceKey=${encodeURIComponent('2026-08-21T18:00:00+00:00')}`
    );
  });
});
