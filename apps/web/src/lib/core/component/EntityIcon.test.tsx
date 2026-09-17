import { itemToBlockName } from '@core/constant/allBlocks';
import SpreadsheetIcon from '@icon/wide-spreadsheet.svg';
import ContactIcon from '@phosphor/address-book.svg';
import ReminderIcon from '@phosphor/bell-simple.svg';
import SkillIcon from '@phosphor/blueprint.svg';
import SnippetIcon from '@phosphor/brackets-curly.svg';
import CompanyIcon from '@phosphor/building-office.svg';
import CalendarIcon from '@phosphor/calendar.svg';
import AutomationIcon from '@phosphor/clock-clockwise.svg';
import EnvelopeIcon from '@phosphor/envelope.svg';
import EnvelopeOpenIcon from '@phosphor/envelope-open.svg';
import FileIcon from '@phosphor/file.svg';
import FileArchive from '@phosphor/file-archive.svg';
import FilePdf from '@phosphor/file-pdf.svg';
import FolderIcon from '@phosphor/folder-simple.svg';
import GitPullRequestIcon from '@phosphor/git-pull-request.svg';
import HashIcon from '@phosphor/hash-straight.svg';
import ListChecksIcon from '@phosphor/list-checks.svg';
import PhoneIcon from '@phosphor/phone-call.svg';
import SparkleIcon from '@phosphor/sparkle.svg';
import DirectMessageIcon from '@phosphor/users.svg';
import { cleanup, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EntityIcon, getEntityIconType, getIconConfig } from './EntityIcon';

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

const entityGlyphs: [
  string,
  IconInput,
  typeof FileIcon,
  ReturnType<typeof itemToBlockName>?,
][] = [
  ['document', { type: 'document', fileType: 'md' }, FileIcon, 'md'],
  ['unresolved document', { type: 'document' }, FileIcon, 'unknown'],
  [
    'native spreadsheet',
    { type: 'document', fileType: 'spreadsheet' },
    SpreadsheetIcon,
    'unknown',
  ],
  [
    'snippet document',
    { type: 'document', fileType: 'md', subType: { type: 'snippet' } },
    SnippetIcon,
    'snippet',
  ],
  [
    'skill document',
    { type: 'document', subType: { type: 'skill' } },
    SkillIcon,
    'skill',
  ],
  ['task', { type: 'document', subType: { type: 'task' } }, ListChecksIcon],
  ['channel', { type: 'channel', channelType: 'public' }, HashIcon],
  ['message', { type: 'channel_message', channelType: 'private' }, HashIcon],
  ['thread', { type: 'channel_thread', channelType: 'team' }, HashIcon],
  [
    'direct message',
    { type: 'channel', channelType: 'direct_message' },
    DirectMessageIcon,
  ],
  [
    'direct thread',
    { type: 'channel_thread', channelType: 'direct_message' },
    DirectMessageIcon,
  ],
  ['email', { type: 'email', isRead: false }, EnvelopeIcon],
  ['read email', { type: 'email', isRead: true }, EnvelopeOpenIcon],
  ['chat', { type: 'chat' }, SparkleIcon],
  ['agent', { type: 'agent_session' }, SparkleIcon],
  ['project', { type: 'project' }, FolderIcon],
  ['calendar', { type: 'calendar_event' }, CalendarIcon],
  ['reminder', { type: 'reminder' }, ReminderIcon],
  ['call', { type: 'call' }, PhoneIcon],
  ['automation', { type: 'automation' }, AutomationIcon],
  [
    'GitHub pull request',
    { type: 'foreign', foreignSource: 'github_pull_request' },
    GitPullRequestIcon,
  ],
  ['company', { type: 'crm_company' }, CompanyIcon],
  ['contact', { type: 'crm_contact' }, ContactIcon],
];

afterEach(cleanup);

describe('entity glyphs', () => {
  beforeEach(() => {
    vi.mocked(itemToBlockName).mockReset();
  });

  it.each(entityGlyphs)(
    'renders the shared %s glyph',
    (_, entity, Glyph, blockName) => {
      vi.mocked(itemToBlockName).mockReturnValue(blockName ?? 'unknown');
      const targetType = getEntityIconType(entity);
      expect(getIconConfig(targetType).icon).toBe(Glyph);

      const actual = render(() => <EntityIcon targetType={targetType} />);
      const expected = render(() => <Glyph />);
      const actualSvg = actual.container.querySelector('svg');
      const expectedSvg = expected.container.querySelector('svg');
      expect(actualSvg).not.toBeNull();
      expect(actualSvg?.innerHTML).toBe(expectedSvg?.innerHTML);
    }
  );

  it('keeps archive documents distinct from unresolved documents', () => {
    vi.mocked(itemToBlockName).mockReturnValue('unknown');
    const targetType = getEntityIconType({
      type: 'document',
      fileType: 'zip',
    });
    expect(targetType).toBe('archive');
    expect(getIconConfig(targetType).icon).toBe(FileArchive);
  });

  it('uses the Phosphor file-format icon for PDF documents', () => {
    const entity = { type: 'document', fileType: 'pdf' } as const;
    vi.mocked(itemToBlockName).mockReturnValue('pdf');
    const targetType = getEntityIconType(entity);
    expect(targetType).toBe('pdf');
    expect(itemToBlockName).toHaveBeenCalledWith(entity, true);
    const Glyph = FilePdf;
    expect(getIconConfig(targetType).icon).toBe(Glyph);
    const actual = render(() => <EntityIcon targetType={targetType} />);
    const expected = render(() => <Glyph />);
    expect(actual.container.querySelector('svg')?.innerHTML).toBe(
      expected.container.querySelector('svg')?.innerHTML
    );
  });
});

describe('EntityIcon weight', () => {
  it('uses the chat color treatment for agents', () => {
    expect(getIconConfig('agent')).toMatchObject({
      foreground: 'text-chat',
      background: 'bg-chat/20',
    });
  });

  it('selects the requested weight from the icon config', () => {
    expect(getIconConfig('md', 'bold').icon).toBe(getIconConfig('md').boldIcon);
    expect(getIconConfig('md').icon).not.toBe(getIconConfig('md').boldIcon);
  });

  it('reacts to weight changes', () => {
    const [weight, setWeight] = createSignal<'regular' | 'bold'>('regular');
    const view = render(() => <EntityIcon targetType="md" weight={weight()} />);
    const regularPath = view.container.querySelector('path')?.getAttribute('d');

    setWeight('bold');

    expect(view.container.querySelector('path')?.getAttribute('d')).not.toBe(
      regularPath
    );
  });
});
