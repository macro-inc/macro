import { describe, expect, it } from 'vitest';
import { composerMentions, withMentions } from './mentions';
import {
  describeSystemLine,
  formatDuration,
  type SystemLine,
  systemLineSentence,
} from './rich';

const ana = { name: 'Ana' };
const ben = { name: 'Ben' };
const line = (partial: Partial<SystemLine>): SystemLine => ({
  type: 'system',
  action: 'icon_changed',
  actor: ana,
  participants: [],
  ...partial,
});
const sentence = (partial: Partial<SystemLine>) =>
  systemLineSentence(describeSystemLine(line(partial)));

describe('system lines', () => {
  it('words every group event like WhatsApp', () => {
    expect(sentence({ action: 'group_created', value: 'Launch' })).toBe(
      'Ana created the group “Launch”'
    );
    expect(
      sentence({
        action: 'participants_added',
        participants: [ben, { name: '+1 555' }],
      })
    ).toBe('Ana added Ben and +1 555');
    expect(
      sentence({ action: 'participants_removed', participants: [ben] })
    ).toBe('Ana removed Ben');
    expect(
      sentence({
        action: 'participants_left',
        actor: undefined,
        participants: [ben],
      })
    ).toBe('Ben left');
    expect(
      sentence({ action: 'participants_joined', participants: [ben] })
    ).toBe("Ben joined using this group's invite link");
    expect(
      sentence({ action: 'participants_promoted', participants: [ben] })
    ).toBe('Ana made Ben an admin');
    expect(
      sentence({ action: 'participants_demoted', participants: [ben] })
    ).toBe('Ana dismissed Ben as admin');
    expect(sentence({ action: 'subject_changed', value: 'Launch' })).toBe(
      'Ana changed the subject to “Launch”'
    );
    expect(sentence({ action: 'icon_changed' })).toBe(
      'Ana changed the group icon'
    );
    expect(sentence({ action: 'description_changed', value: 'x' })).toBe(
      'Ana changed the group description'
    );
    expect(sentence({ action: 'description_changed' })).toBe(
      'Ana removed the group description'
    );
    expect(sentence({ action: 'disappearing_changed', value: '604800' })).toBe(
      'Ana turned on disappearing messages (7 days)'
    );
    expect(sentence({ action: 'disappearing_changed', value: '0' })).toBe(
      'Ana turned off disappearing messages'
    );
    expect(sentence({ action: 'message_pinned' })).toBe('Ana pinned a message');
    expect(sentence({ action: 'message_unpinned' })).toBe(
      'Ana unpinned a message'
    );
    expect(
      sentence({
        action: 'call',
        call: { video: true, outcome: 'missed' },
      })
    ).toBe('Missed group video call');
    expect(
      sentence({
        action: 'call',
        call: { video: false, outcome: 'answered', durationSeconds: 125 },
      })
    ).toBe('Group voice call · 2:05');
  });

  it('starts with the verb when WhatsApp did not say who', () => {
    expect(sentence({ action: 'icon_changed', actor: undefined })).toBe(
      'Changed the group icon'
    );
  });

  it('shortens long participant lists', () => {
    expect(
      sentence({
        action: 'participants_added',
        participants: [ben, { name: 'Cy' }, { name: 'Dee' }, { name: 'Eve' }],
      })
    ).toBe('Ana added Ben, Cy and 2 others');
  });
});

describe('durations', () => {
  it('reads like a media player', () => {
    expect(formatDuration(42)).toBe('0:42');
    expect(formatDuration(725)).toBe('12:05');
    expect(formatDuration(3723)).toBe('1:02:03');
  });
});

describe('mentions', () => {
  it('names mentioned people in received text', () => {
    expect(
      withMentions('hi @1555 and @1666, not @15550', [
        { token: '1555', name: 'Ben', userId: 'macro|ben@x.test' },
        { token: '1666', name: 'Cy_[x]' },
      ])
    ).toBe(
      'hi <m-user-mention>{"userId":"macro|ben@x.test","email":"ben@x.test","displayName":"Ben"}</m-user-mention> and **@Cy\\_\\[x\\]**, not @15550'
    );
  });

  it('turns composer chips into WhatsApp mentions of participants only', () => {
    const chip = (userId: string, displayName: string) =>
      `<m-user-mention>${JSON.stringify({ userId, email: 'x', displayName })}</m-user-mention>`;
    expect(
      composerMentions(
        `${chip('1555@s.whatsapp.net', 'Ben')} ${chip('42@lid', 'Cy')} ${chip('macro|z@x.test', 'Zed')} ${chip('1555@s.whatsapp.net', 'Ben')}`,
        ['1555@s.whatsapp.net', '42@lid']
      )
    ).toEqual({
      markdown: '@1555 @42 @Zed @1555',
      mentions: ['1555@s.whatsapp.net', '42@lid'],
    });
  });
});
