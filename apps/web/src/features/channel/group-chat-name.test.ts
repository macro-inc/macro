import { describe, expect, it } from 'vitest';
import {
  channelListName,
  groupChatName,
  isNamedForPeople,
} from './group-chat-name';

describe('groupChatName', () => {
  it('keeps the first two people and counts the rest', () => {
    expect(groupChatName('Ana, Leo, Mara, Noor, Sam')).toBe(
      'Ana, Leo and 3 others'
    );
  });

  it('leaves short lists and chosen names alone', () => {
    expect(groupChatName('Ana, Leo, Mara')).toBe('Ana, Leo, Mara');
    expect(groupChatName('remote')).toBe('remote');
  });
});

describe('isNamedForPeople', () => {
  it('reads a comma-separated list as people', () => {
    expect(isNamedForPeople('Ana, Leo')).toBe(true);
    expect(isNamedForPeople('bug-reports')).toBe(false);
  });
});

describe('channelListName', () => {
  it('shortens only group chats', () => {
    const name = 'Ana, Leo, Mara, Noor';
    expect(channelListName({ name, channelType: 'private' })).toBe(
      'Ana, Leo and 2 others'
    );
    expect(channelListName({ name, channelType: 'public' })).toBe(name);
  });
});
