import { itemToBlockName } from '@core/constant/allBlocks';
import ContactIcon from '@icon/system/regular/address-book.svg';
import SkillIcon from '@icon/system/regular/blueprint.svg';
import SnippetIcon from '@icon/system/regular/brackets-curly.svg';
import CompanyIcon from '@icon/system/regular/building-office.svg';
import CalendarIcon from '@icon/system/regular/calendar.svg';
import RoutineIcon from '@icon/system/regular/clock-clockwise.svg';
import DatabaseIcon from '@icon/system/regular/database.svg';
import EnvelopeIcon from '@icon/system/regular/envelope.svg';
import EnvelopeOpenIcon from '@icon/system/regular/envelope-open.svg';
import FileIcon from '@icon/system/regular/file.svg';
import FileArchive from '@icon/system/regular/file-archive.svg';
import FilePdf from '@icon/system/regular/file-pdf.svg';
import FolderIcon from '@icon/system/regular/folder-simple.svg';
import GitPullRequestIcon from '@icon/system/regular/git-pull-request.svg';
import HashIcon from '@icon/system/regular/hash-straight.svg';
import ListChecksIcon from '@icon/system/regular/list-checks.svg';
import PhoneIcon from '@icon/system/regular/phone-call.svg';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import SpreadsheetIcon from '@icon/system/regular/table.svg';
import DirectMessageIcon from '@icon/system/regular/users.svg';
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
  ['call', { type: 'call' }, PhoneIcon],
  ['routine', { type: 'routine' }, RoutineIcon],
  [
    'GitHub pull request',
    { type: 'foreign', foreignSource: 'github_pull_request' },
    GitPullRequestIcon,
  ],
  ['company', { type: 'crm_company' }, CompanyIcon],
  ['contact', { type: 'crm_contact' }, ContactIcon],
  ['database', { type: 'database' }, DatabaseIcon],
];

afterEach(cleanup);

describe('entity glyphs', () => {
  it('keeps the routine icon and label for saved mentions using the old block name', () => {
    expect(getIconConfig('automation')).toEqual(getIconConfig('routine'));
    expect(getIconConfig('automation').icon).toBe(RoutineIcon);
  });

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
    const regularIcon = view.container.querySelector('svg');
    expect(regularIcon?.getAttribute('stroke-width')).toBe('2');
    const regularPath = regularIcon?.querySelector('path')?.getAttribute('d');
    expect(regularPath).toBeTruthy();

    setWeight('bold');

    const boldIcon = view.container.querySelector('svg');
    expect(boldIcon?.getAttribute('stroke-width')).toBe('2.3');
    expect(boldIcon?.querySelector('path')?.getAttribute('d')).toBe(
      regularPath
    );
  });
});
