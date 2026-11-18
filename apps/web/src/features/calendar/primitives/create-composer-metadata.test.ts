import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import type { EventEditorSubmitValues } from '../components/composer/event-form-model';
import { createComposerMetadata } from './create-composer-metadata';

const VALUES: EventEditorSubmitValues = {
  title: 'Planning',
  time: {
    kind: 'timed',
    startsAt: '2026-07-01T09:00:00Z',
    endsAt: '2026-07-01T10:00:00Z',
    timeZone: 'UTC',
  },
  guestEmails: [],
  location: '',
  description: '',
  conferenceChoice: 'none',
};
const RANGE = {
  allDay: false,
  start: '2026-07-01T09:00',
  end: '2026-07-01T10:00',
};

describe('composer metadata', () => {
  it('converts fields already expressed in a nonlocal zone without inventing an edit', () => {
    createRoot((dispose) => {
      const metadata = createComposerMetadata({
        isEdit: true,
        initial: { timeZone: 'America/New_York' },
        timeZoneRelevant: () => true,
      });
      const submission = metadata.submission(VALUES, RANGE);
      expect(submission?.values.time).toMatchObject({
        startsAt: '2026-07-01T13:00:00.000Z',
        endsAt: '2026-07-01T14:00:00.000Z',
        timeZone: 'America/New_York',
      });
      expect(submission?.changes).toEqual({});
      expect(metadata.isDirty()).toBe(false);
      dispose();
    });
  });

  it('preserves an untouched submission and leaves metadata absent', () => {
    createRoot((dispose) => {
      const metadata = createComposerMetadata({
        isEdit: true,
        initial: { timeZone: 'UTC', visibility: 'private' },
        timeZoneRelevant: () => true,
      });
      const submission = metadata.submission(VALUES, RANGE);
      expect(submission?.values).toBe(VALUES);
      expect(submission?.changes).toEqual({});
      expect(metadata.isDirty()).toBe(false);
      dispose();
    });
  });

  it('tracks explicit changes and resets them with the draft', () => {
    createRoot((dispose) => {
      const metadata = createComposerMetadata({
        isEdit: true,
        initial: { timeZone: 'UTC', visibility: 'private' },
        timeZoneRelevant: () => true,
      });
      metadata.setVisibility('public');
      metadata.setTimeZone('America/New_York');
      const submission = metadata.submission(VALUES, RANGE);
      expect(submission?.changes).toEqual({
        visibility: 'public',
        timeZoneChanged: true,
      });
      expect(submission?.values.time).toMatchObject({
        startsAt: '2026-07-01T13:00:00.000Z',
        timeZone: 'America/New_York',
      });
      expect(metadata.isDirty()).toBe(true);
      metadata.reset();
      expect(metadata.isDirty()).toBe(false);
      expect(metadata.submission(VALUES, RANGE)?.changes).toEqual({});
      dispose();
    });
  });

  it('keeps confidential unchanged until the viewer explicitly chooses Private', () => {
    createRoot((dispose) => {
      const metadata = createComposerMetadata({
        isEdit: true,
        initial: { timeZone: 'UTC', visibility: 'confidential' },
        timeZoneRelevant: () => true,
      });
      expect(metadata.state.visibility).toBe('confidential');
      expect(metadata.submission(VALUES, RANGE)?.changes).toEqual({});
      metadata.setVisibility('private');
      expect(metadata.submission(VALUES, RANGE)?.changes).toEqual({
        visibility: 'private',
      });
      dispose();
    });
  });

  it('does not make a date-only event dirty from a time-zone-only choice', () => {
    createRoot((dispose) => {
      const metadata = createComposerMetadata({
        isEdit: false,
        initial: { timeZone: 'UTC' },
        timeZoneRelevant: () => false,
      });
      metadata.setTimeZone('America/New_York');
      expect(metadata.isDirty()).toBe(false);
      expect(metadata.setTimeZone('Invalid/Zone')).toBe(false);
      expect(metadata.state.timeZone).toBe('America/New_York');
      dispose();
    });
  });
});
