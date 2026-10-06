import { describe, expect, it } from 'vitest';
import {
  isBlockedByTeam,
  RECORDING_KINDS,
  type RecordingKinds,
  type RecordingSettings,
  recordsByDefault,
  withKind,
} from './recording-kinds';

const ALL: RecordingKinds = {
  huddles: true,
  internalMeetings: true,
  externalMeetings: true,
};
const NONE: RecordingKinds = {
  huddles: false,
  internalMeetings: false,
  externalMeetings: false,
};

const settings = (
  recordByDefault: RecordingKinds,
  blocked: RecordingKinds | null
): RecordingSettings => ({
  recordByDefault,
  team: blocked ? { blocked, canEdit: false } : null,
});

describe('call recording kinds', () => {
  it('lists huddles, internal meetings and external meetings in that order', () => {
    expect(RECORDING_KINDS.map((option) => option.kind)).toEqual([
      'huddles',
      'internalMeetings',
      'externalMeetings',
    ]);
  });

  it('records the kinds a person chose when nothing is blocked', () => {
    const chosen = settings(withKind(NONE, 'huddles', true), null);
    expect(recordsByDefault(chosen, 'huddles')).toBe(true);
    expect(recordsByDefault(chosen, 'internalMeetings')).toBe(false);
    expect(isBlockedByTeam(chosen, 'huddles')).toBe(false);
  });

  it('never records a kind the team blocks', () => {
    const blocked = settings(ALL, withKind(NONE, 'externalMeetings', true));
    expect(isBlockedByTeam(blocked, 'externalMeetings')).toBe(true);
    expect(recordsByDefault(blocked, 'externalMeetings')).toBe(false);
    expect(recordsByDefault(blocked, 'internalMeetings')).toBe(true);
  });

  it('turns recording off when every default is cleared', () => {
    const off = settings(NONE, NONE);
    for (const option of RECORDING_KINDS) {
      expect(recordsByDefault(off, option.kind)).toBe(false);
    }
  });

  it('changes one kind without mutating the input', () => {
    const changed = withKind(ALL, 'internalMeetings', false);
    expect(changed).toEqual({ ...ALL, internalMeetings: false });
    expect(ALL.internalMeetings).toBe(true);
  });
});
