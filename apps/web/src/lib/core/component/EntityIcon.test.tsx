import WideBook from '@icon/wide-book.svg';
import AlarmIcon from '@phosphor/alarm.svg';
import ArticleIcon from '@phosphor/article.svg';
import BuildingsIcon from '@phosphor/buildings.svg';
import CalendarIcon from '@phosphor/calendar-blank.svg';
import ChatsIcon from '@phosphor/chats-circle.svg';
import EnvelopeIcon from '@phosphor/envelope.svg';
import FilePdf from '@phosphor/file-pdf.svg';
import FolderIcon from '@phosphor/folder-simple.svg';
import GitPullRequestIcon from '@phosphor/git-pull-request.svg';
import HashIcon from '@phosphor/hash.svg';
import LightningIcon from '@phosphor/lightning.svg';
import ListChecksIcon from '@phosphor/list-checks.svg';
import PhoneIcon from '@phosphor/phone.svg';
import SparkleIcon from '@phosphor/sparkle.svg';
import UsersIcon from '@phosphor/users.svg';
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EntityIcon, getEntityIconType, getIconConfig } from './EntityIcon';

const flags = vi.hoisted(() => ({ wideIcons: false }));
vi.mock('@core/constant/featureFlags', () => ({
  get USE_WIDE_ICONS() {
    return flags.wideIcons;
  },
}));
vi.mock('@core/constant/allBlocks', () => ({
  blockAcceptedFileExtensionSet: new Set(),
  fileTypeToBlockName: vi.fn(),
  isBlockAlias: () => false,
  itemToBlockName: vi.fn(),
}));
vi.mock('@ui', async () => ({
  cn: (await import('@ui/utils/classname')).cn,
}));

type IconInput = Parameters<typeof getEntityIconType>[0];

const entityGlyphs: [string, IconInput, typeof ArticleIcon][] = [
  ['document', { type: 'document', fileType: 'md' }, ArticleIcon],
  ['PDF document', { type: 'document', fileType: 'pdf' }, ArticleIcon],
  [
    'skill document',
    { type: 'document', subType: { type: 'skill' } },
    ArticleIcon,
  ],
  ['task', { type: 'document', subType: { type: 'task' } }, ListChecksIcon],
  ['channel', { type: 'channel', channelType: 'public' }, HashIcon],
  ['message', { type: 'channel_message', channelType: 'private' }, HashIcon],
  ['thread', { type: 'channel_thread', channelType: 'team' }, HashIcon],
  [
    'direct message',
    { type: 'channel', channelType: 'direct_message' },
    ChatsIcon,
  ],
  [
    'direct thread',
    { type: 'channel_thread', channelType: 'direct_message' },
    ChatsIcon,
  ],
  ['email', { type: 'email', isRead: false }, EnvelopeIcon],
  ['read email', { type: 'email', isRead: true }, EnvelopeIcon],
  ['chat', { type: 'chat' }, SparkleIcon],
  ['agent', { type: 'agent_session' }, SparkleIcon],
  ['project', { type: 'project' }, FolderIcon],
  ['calendar', { type: 'calendar_event' }, CalendarIcon],
  ['reminder', { type: 'reminder' }, AlarmIcon],
  ['call', { type: 'call' }, PhoneIcon],
  ['automation', { type: 'automation' }, LightningIcon],
  ['foreign entity', { type: 'foreign' }, GitPullRequestIcon],
  ['company', { type: 'crm_company' }, BuildingsIcon],
  ['contact', { type: 'crm_contact' }, UsersIcon],
];

afterEach(cleanup);

describe.each([false, true])(
  'entity glyphs with wide icons %s',
  (wideIcons) => {
    beforeEach(() => {
      flags.wideIcons = wideIcons;
    });

    it.each(entityGlyphs)('renders the shared %s glyph', (_, entity, Glyph) => {
      const targetType = getEntityIconType(entity);
      expect(getIconConfig(targetType).icon).toBe(Glyph);

      const actual = render(() => <EntityIcon targetType={targetType} />);
      const expected = render(() => <Glyph />);
      const actualSvg = actual.container.querySelector('svg');
      const expectedSvg = expected.container.querySelector('svg');
      expect(actualSvg).not.toBeNull();
      expect(actualSvg?.innerHTML).toBe(expectedSvg?.innerHTML);
    });

    it('uses the selected file-format variant for explicit PDF icons', () => {
      const Glyph = wideIcons ? WideBook : FilePdf;
      expect(getIconConfig('pdf').icon).toBe(Glyph);
      const actual = render(() => <EntityIcon targetType="pdf" />);
      const expected = render(() => <Glyph />);
      expect(actual.container.querySelector('svg')?.innerHTML).toBe(
        expected.container.querySelector('svg')?.innerHTML
      );
    });
  }
);
