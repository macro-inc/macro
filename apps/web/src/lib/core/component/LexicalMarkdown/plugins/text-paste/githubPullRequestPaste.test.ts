import { $isLinkNode, LinkNode } from '@lexical/link';
import {
  $isPullRequestMentionNode,
  PullRequestMentionNode,
} from '@macro-inc/lexical-core';
import {
  fetchPullRequestByGithubKey,
  getCachedPullRequestByGithubKey,
} from '@queries/storage/pr-mention';
import type { ForeignEntity } from '@service-storage/generated/schemas';
import {
  $createParagraphNode,
  $getRoot,
  $isElementNode,
  COMMAND_PRIORITY_EDITOR,
  createEditor,
  type LexicalEditor,
  type LexicalNode,
  PASTE_COMMAND,
} from 'lexical';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INSERT_PR_MENTION_COMMAND } from '../mentions';
import { textPastePlugin } from './textPastePlugin';

// Keep the paste tests independent of application boot and editor UI wiring.
vi.mock('@core/internal/BlockLoader', () => ({}));
vi.mock('../../utils', () => ({}));
vi.mock('../mentions', async () => {
  const { createCommand } = await import('lexical');
  return {
    INSERT_DOCUMENT_MENTION_COMMAND: createCommand('INSERT_DOCUMENT_MENTION'),
    INSERT_PR_MENTION_COMMAND: createCommand('INSERT_PR_MENTION'),
    INSERT_THEME_MENTION_COMMAND: createCommand('INSERT_THEME_MENTION'),
  };
});
vi.mock('@queries/storage/pr-mention', () => ({
  fetchPullRequestByGithubKey: vi.fn(),
  getCachedPullRequestByGithubKey: vi.fn(),
}));

const PR_URL = 'https://github.com/macro-inc/macro/pull/7870';
const ENTITY = {
  id: '019507e8-14a3-7bc1-8610-419f16bd03a8',
  foreignEntitySource: 'github_pull_request',
  foreignEntityId: 'macro-inc/macro/pull/7870',
} as ForeignEntity;

class TestClipboardEvent extends Event {
  clipboardData: DataTransfer;
  constructor(text: string) {
    super('paste');
    this.clipboardData = {
      getData: (type: string) => (type === 'text/plain' ? text : ''),
    } as DataTransfer;
  }
}

let editor: LexicalEditor;
let unregister: () => void;

function paste(text: string): boolean {
  let handled = false;
  editor.update(
    () => {
      handled = editor.dispatchCommand(
        PASTE_COMMAND,
        new TestClipboardEvent(text) as ClipboardEvent
      );
    },
    { discrete: true }
  );
  return handled;
}

function $paragraphChildren(): LexicalNode[] {
  const paragraph = $getRoot().getFirstChild();
  return $isElementNode(paragraph) ? paragraph.getChildren() : [];
}

function readParagraph(fn: (children: LexicalNode[]) => void) {
  editor.getEditorState().read(() => fn($paragraphChildren()));
}

async function flushLookup() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  vi.stubGlobal('ClipboardEvent', TestClipboardEvent);
  editor = createEditor({
    nodes: [LinkNode, PullRequestMentionNode],
    onError: (error) => {
      throw error;
    },
  });
  editor.update(
    () => {
      const paragraph = $createParagraphNode();
      $getRoot().append(paragraph);
      paragraph.select();
    },
    { discrete: true }
  );
  unregister = textPastePlugin()(editor);
});

afterEach(() => {
  unregister();
  vi.unstubAllGlobals();
  vi.mocked(fetchPullRequestByGithubKey).mockReset();
  vi.mocked(getCachedPullRequestByGithubKey).mockReset();
});

describe('GitHub pull request smart paste', () => {
  it('inserts a link and upgrades it to a PR mention once the PR resolves', async () => {
    vi.mocked(fetchPullRequestByGithubKey).mockResolvedValue(ENTITY);

    expect(paste(PR_URL)).toBe(true);
    expect(fetchPullRequestByGithubKey).toHaveBeenCalledWith(
      'macro-inc/macro/pull/7870'
    );
    await flushLookup();

    readParagraph((children) => {
      expect(children).toHaveLength(1);
      const [mention] = children;
      expect($isPullRequestMentionNode(mention)).toBe(true);
      if (!$isPullRequestMentionNode(mention)) return;
      expect(mention.getId()).toBe(ENTITY.id);
      expect(mention.getLabel()).toBe('macro-inc/macro#7870');
      expect(mention.getUrl()).toBe(PR_URL);
    });
  });

  it('inserts the mention directly when the PR is already cached', () => {
    vi.mocked(getCachedPullRequestByGithubKey).mockReturnValue(ENTITY);
    const insertMention = vi.fn(() => true);
    const unregisterInsert = editor.registerCommand(
      INSERT_PR_MENTION_COMMAND,
      insertMention,
      COMMAND_PRIORITY_EDITOR
    );

    expect(paste(`${PR_URL}/files`)).toBe(true);
    unregisterInsert();

    expect(insertMention).toHaveBeenCalledWith(
      { id: ENTITY.id, label: 'macro-inc/macro#7870', url: PR_URL },
      editor
    );
    expect(fetchPullRequestByGithubKey).not.toHaveBeenCalled();
  });

  it('keeps the link when Macro has not synced the PR', async () => {
    vi.mocked(fetchPullRequestByGithubKey).mockResolvedValue(null);

    paste(PR_URL);
    await flushLookup();

    readParagraph((children) => {
      expect(children).toHaveLength(1);
      const [link] = children;
      expect($isLinkNode(link)).toBe(true);
      if (!$isLinkNode(link)) return;
      expect(link.getURL()).toBe(PR_URL);
      expect(link.getTextContent()).toBe(PR_URL);
    });
  });

  it('leaves the link alone if it was edited before the PR resolved', async () => {
    let resolveLookup!: (entity: ForeignEntity) => void;
    vi.mocked(fetchPullRequestByGithubKey).mockReturnValue(
      new Promise((resolve) => {
        resolveLookup = resolve;
      })
    );

    paste(PR_URL);
    editor.update(
      () => {
        const [link] = $paragraphChildren();
        if ($isLinkNode(link)) link.setURL('https://example.com');
      },
      { discrete: true }
    );
    resolveLookup(ENTITY);
    await flushLookup();

    readParagraph((children) => {
      expect(children.some($isPullRequestMentionNode)).toBe(false);
    });
  });

  it('does not handle non-PR GitHub links', () => {
    expect(paste('https://github.com/macro-inc/macro/issues/1')).toBe(false);
    expect(fetchPullRequestByGithubKey).not.toHaveBeenCalled();
  });
});
