import { describe, expect, it } from 'vitest';
import {
  type CallSettings,
  isHuddleSharingBlocked,
  isRecordingBlocked,
  RECORDING_KINDS,
  type RecordingKinds,
  recordsByDefault,
  type ShareByDefault,
  shareAudience,
  withKind,
} from './call-settings';

const ALL: RecordingKinds = {
  huddles: true,
  oneOnOnes: true,
  internalMeetings: true,
  externalMeetings: true,
};
const NONE: RecordingKinds = {
  huddles: false,
  oneOnOnes: false,
  internalMeetings: false,
  externalMeetings: false,
};

const SHARE_DEFAULTS: ShareByDefault = {
  huddles: 'channel',
  oneOnOnes: 'participants',
  internalMeetings: 'invited',
  externalMeetings: 'team',
};

const settings = (
  recordByDefault: RecordingKinds,
  recordingBlocked: RecordingKinds | null,
  sharing: { byDefault?: ShareByDefault; blocked?: boolean } = {}
): CallSettings => ({
  recordByDefault,
  shareByDefault: sharing.byDefault ?? SHARE_DEFAULTS,
  refuseOneOnOneRecording: false,
  team: recordingBlocked
    ? {
        recordingBlocked,
        huddleSharingBlocked: sharing.blocked ?? false,
        canEdit: false,
      }
    : null,
});

describe('call settings', () => {
  it('lists huddles, then meetings from smallest to most open', () => {
    expect(RECORDING_KINDS.map((option) => option.kind)).toEqual([
      'huddles',
      'oneOnOnes',
      'internalMeetings',
      'externalMeetings',
    ]);
  });

  it('records the kinds a person chose when nothing is blocked', () => {
    const chosen = settings(withKind(NONE, 'huddles', true), null);
    expect(recordsByDefault(chosen, 'huddles')).toBe(true);
    expect(recordsByDefault(chosen, 'internalMeetings')).toBe(false);
    expect(isRecordingBlocked(chosen, 'huddles')).toBe(false);
  });

  it('never records a kind the team blocks', () => {
    const blocked = settings(ALL, withKind(NONE, 'externalMeetings', true));
    expect(isRecordingBlocked(blocked, 'externalMeetings')).toBe(true);
    expect(recordsByDefault(blocked, 'externalMeetings')).toBe(false);
    expect(recordsByDefault(blocked, 'internalMeetings')).toBe(true);
  });

  it('turns recording off when every default is cleared', () => {
    const off = settings(NONE, NONE);
    for (const option of RECORDING_KINDS) {
      expect(recordsByDefault(off, option.kind)).toBe(false);
    }
  });

  it('offers each kind only the audiences it can have', () => {
    expect(
      Object.fromEntries(
        RECORDING_KINDS.map((option) => [option.kind, option.audiences])
      )
    ).toEqual({
      huddles: ['channel', 'team'],
      oneOnOnes: ['participants', 'team'],
      internalMeetings: ['participants', 'invited', 'team'],
      externalMeetings: ['participants', 'invited', 'team'],
    });
    for (const option of RECORDING_KINDS) {
      expect(option.audiences).toContain(SHARE_DEFAULTS[option.kind]);
    }
  });

  it('shares each kind with the chosen audience', () => {
    const chosen = settings(ALL, null);
    expect(shareAudience(chosen, 'huddles')).toBe('channel');
    expect(shareAudience(chosen, 'externalMeetings')).toBe('team');
  });

  it('keeps huddles in their channel when the team blocks sharing them', () => {
    const blocked = settings(ALL, NONE, {
      byDefault: { ...SHARE_DEFAULTS, huddles: 'team', oneOnOnes: 'team' },
      blocked: true,
    });
    expect(isHuddleSharingBlocked(blocked)).toBe(true);
    expect(shareAudience(blocked, 'huddles')).toBe('channel');
    // 1:1 meetings are not huddles, so the choice still applies to them.
    expect(shareAudience(blocked, 'oneOnOnes')).toBe('team');
  });

  it('changes one kind without mutating the input', () => {
    const changed = withKind(ALL, 'internalMeetings', false);
    expect(changed).toEqual({ ...ALL, internalMeetings: false });
    expect(ALL.internalMeetings).toBe(true);
  });
});
