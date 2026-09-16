import WideUnknown from '@icon/wide-unknown.svg';
import CalendarIcon from '@phosphor/calendar-blank.svg';
import EnvelopeIcon from '@phosphor/envelope.svg';
import EnvelopeOpenIcon from '@phosphor/envelope-open.svg';
import FileIcon from '@phosphor/file.svg';
import GitMergeIcon from '@phosphor/git-merge.svg';
import GitPullRequestIcon from '@phosphor/git-pull-request.svg';
import { cleanup, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeEntityIcon } from '../../inbox-view/components/HomeEntityIcon';
import { EntityIcon } from '../extractors/entity-icon';
import type {
  EmailEntity,
  GithubPullRequestEntity,
  UnknownForeignEntity,
} from '../types/entity';

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
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'user' }));
vi.mock('@core/component/UserIcon', () => ({ UserIcon: () => null }));
vi.mock('../components/ChatProviderIcon', () => ({
  ChatProviderIcon: () => null,
}));
vi.mock('@ui', async () => ({
  cn: (await import('@ui/utils/classname')).cn,
}));

const foreignBase = {
  type: 'foreign',
  id: 'foreign-id',
  name: 'Foreign entity',
  ownerId: 'user',
  foreignId: 'external-id',
  storedForId: 'team-id',
  storedForAuthEntity: 'team',
} as const;

function pullRequest(
  status: GithubPullRequestEntity['metadata']['status']
): GithubPullRequestEntity {
  return {
    ...foreignBase,
    foreignSource: 'github_pull_request',
    metadata: {
      number: 42,
      name: 'Update icons',
      owner: 'macro-inc',
      repo: 'macro',
      url: 'https://github.com/macro-inc/macro/pull/42',
      status,
      additions: 1,
      deletions: 1,
      comments: [],
      checks: [],
    },
  };
}

function expectGlyph(container: HTMLElement, Glyph: typeof FileIcon) {
  const expected = render(() => <Glyph />);
  const svg = container.querySelector('svg');
  expect(svg).not.toBeNull();
  expect(svg?.innerHTML).toBe(
    expected.container.querySelector('svg')?.innerHTML
  );
}

afterEach(cleanup);

describe.each([false, true])('Entity.Icon with wide icons %s', (wideIcons) => {
  beforeEach(() => {
    flags.wideIcons = wideIcons;
  });

  it.each([
    [false, false, EnvelopeIcon, 'text-email'],
    [true, false, EnvelopeOpenIcon, 'text-default'],
    [false, true, CalendarIcon, 'text-calendar'],
    [true, true, CalendarIcon, 'text-calendar'],
  ] as const)(
    'distinguishes read=%s and invite=%s emails',
    (isRead, hasIcsAttachment, Glyph, color) => {
      const entity: EmailEntity = {
        type: 'email',
        id: 'email-id',
        name: 'Email',
        ownerId: 'user',
        isRead,
        hasIcsAttachment,
        isDraft: false,
        isImportant: false,
        done: false,
      };
      const { container } = render(() => <EntityIcon entity={entity} />);
      expectGlyph(container, Glyph);
      expect(container.firstElementChild?.classList.contains(color)).toBe(true);
    }
  );

  it.each([
    ['open', GitPullRequestIcon, 'text-success'],
    ['merged', GitMergeIcon, 'text-note'],
    ['closed', GitPullRequestIcon, 'text-failure'],
  ] as const)('renders the %s pull request state', (status, Glyph, color) => {
    const { container } = render(() => (
      <EntityIcon entity={pullRequest(status)} />
    ));
    expectGlyph(container, Glyph);
    expect(container.firstElementChild?.classList.contains(color)).toBe(true);
  });

  it('uses a generic file for unknown foreign sources even with PR-like metadata', () => {
    const entity: UnknownForeignEntity = {
      ...foreignBase,
      foreignSource: 'unknown',
      rawForeignSource: 'another-provider',
      metadata: { status: 'merged' },
    };
    const { container } = render(() => <EntityIcon entity={entity} />);
    expectGlyph(container, wideIcons ? WideUnknown : FileIcon);
    expect(
      container.firstElementChild?.classList.contains('text-default')
    ).toBe(true);
  });

  it('updates the pull request glyph and color when its status changes', () => {
    const [entity, setEntity] = createSignal(pullRequest('open'));
    const { container } = render(() => <EntityIcon entity={entity()} />);

    setEntity(pullRequest('merged'));

    expectGlyph(container, GitMergeIcon);
    expect(container.firstElementChild?.classList.contains('text-note')).toBe(
      true
    );
    expect(
      container.firstElementChild?.classList.contains('text-success')
    ).toBe(false);
  });

  it('preserves pull request status colors in compact Home rows', () => {
    const { container } = render(() => (
      <HomeEntityIcon entity={pullRequest('merged')} />
    ));
    expectGlyph(container, GitMergeIcon);
    const classes = container.querySelector('svg')?.parentElement?.classList;
    expect(classes?.contains('text-note')).toBe(true);
    expect(classes?.contains('text-current')).toBe(false);
  });
});
