import { openMacroMcpSetupModal } from '@app/features/integrations/mcp-setup/MacroMcpSetupModal';
import type { SplitFileMenuAction } from '@components/app/split-layout/context';
import { editorStateAsMarkdown } from '@core/component/LexicalMarkdown/utils';
import { toast } from '@core/component/Toast/Toast';
import { macroIdToEmail, tryMacroId } from '@core/user';
import { copyBranchNameToClipboard } from '@core/util/branchName';
import ClaudeIcon from '@icon/wide-claude.svg';
import CodexIcon from '@icon/wide-codex-ide.svg';
import CursorIcon from '@icon/wide-cursor-ide.svg';
import ZedIcon from '@icon/wide-zed-ide.svg';
import CaretDown from '@phosphor/caret-down.svg';
import CopyIcon from '@phosphor/copy.svg';
import GitBranch from '@phosphor/git-branch.svg';
import PlugIcon from '@phosphor/plug.svg';
import TerminalWindowIcon from '@phosphor/terminal-window.svg';
import { storageServiceClient } from '@service-storage/client';
import {
  enableUnifiedDocumentDiscussions,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import type { CommentThread } from '@service-storage/generated/schemas/commentThread';
import {
  entityMessagesClient,
  type MessageCursor,
  type MessageParent,
  type MessageThread,
} from '@service-storage/messages';
import { createCallback } from '@solid-primitives/rootless';
import { makePersisted } from '@solid-primitives/storage';
import { Button, ButtonGroup, Dropdown } from '@ui';
import { type Component, createSignal, For, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  sortComments,
  useDiscussionThreads,
} from '../comments/discussionResource';
import { useMarkdownDocument } from '../context/markdown-document-context';
import { useMarkdownName } from './MarkdownNameProvider';

const LAST_USED_KEY = 'dispatch-agent-last-used';

type PromptComment = {
  author: string;
  createdAt?: string | null;
  text: string;
};
type PromptThread = { threadId: string | number; comments: PromptComment[] };

function legacyPromptThreads(threads: CommentThread[]): PromptThread[] {
  return threads.map((thread) => ({
    threadId: thread.thread.threadId,
    comments: [...thread.comments]
      .sort(sortComments)
      .filter((comment) => comment.text && !comment.deletedAt)
      .map((comment) => ({
        author: comment.sender ?? comment.owner,
        createdAt: comment.createdAt,
        text: comment.text,
      })),
  }));
}

function messagePromptThreads(threads: MessageThread[]): PromptThread[] {
  return threads.map((thread) => ({
    threadId: thread.state.root_id,
    comments: [thread.root, ...thread.replies]
      .filter((message) => message.content && !message.deleted_at)
      .map((message) => ({
        author: message.imported_author?.name ?? message.sender_id,
        createdAt: message.created_at,
        text: message.content,
      })),
  }));
}

/** Copy/export needs full discussions, not the timeline's bounded reply previews. */
async function fetchMessagePromptThreads(
  documentId: string
): Promise<PromptThread[]> {
  const parent: MessageParent = { type: 'document', id: documentId };
  const threads: MessageThread[] = [];
  let cursor: MessageCursor | null | undefined;
  do {
    const page = await entityMessagesClient.list(parent, {
      anchored: false,
      limit: 100,
      cursor: cursor ?? undefined,
    });
    for (const root of page.items) {
      threads.push(await entityMessagesClient.thread(parent, root.id));
    }
    cursor = page.next_cursor;
  } while (cursor);
  threads.reverse();
  return messagePromptThreads(threads);
}

async function generateTaskPrompt(
  documentId: string,
  documentName: string,
  content: string,
  threads: PromptThread[]
): Promise<string> {
  const result = await storageServiceClient.getDocumentBranchName({
    documentId,
  });
  if (!result.isOk()) {
    throw new Error('Failed to fetch branch name');
  }
  const { shortId, branchName } = result.value;

  const lines: string[] = [];

  lines.push(`Work on Macro task ${documentName}:`);
  lines.push('');
  lines.push(`<task identifier="${shortId}">`);
  lines.push(`<title>${documentName}</title>`);
  lines.push(`<branch>${branchName}</branch>`);
  lines.push('</task>');

  if (content) {
    lines.push('');
    lines.push('<task-content>');
    lines.push(content);
    lines.push('</task-content>');
  }

  if (threads.length > 0) {
    lines.push('');
    for (const thread of threads) {
      lines.push(`<comment-thread thread-id="${thread.threadId}">`);
      for (const comment of thread.comments) {
        const macroId = tryMacroId(comment.author);
        const author = macroId ? macroIdToEmail(macroId) : comment.author;
        const createdAt = comment.createdAt
          ? ` created-at="${comment.createdAt}"`
          : '';
        lines.push(
          `<comment author="${author}"${createdAt}>${comment.text}</comment>`
        );
      }
      lines.push('</comment-thread>');
    }
  }

  lines.push('');
  lines.push(`Please use the branch "${branchName}" for your work.`);
  lines.push('');
  lines.push(
    'If you have the Macro MCP server enabled, use it to gather additional context about this task.'
  );
  lines.push('');
  lines.push(
    'When committing and titling pull requests, please follow the Conventional Commits spec (e.g. `feat: ...`, `fix: ...`, `chore: ...`) so the history stays consistent.'
  );
  lines.push('');
  lines.push(
    'Keep the pull request description concise, succinct, and useful. No need for test cases or verification steps — just describe exactly what the PR solves and how, and include a link back to the original session if applicable.'
  );

  return lines.join('\n');
}

type AgentAction = {
  key: string;
  name: string;
  icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
  buttonIcon?: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
  execute: (prompt: string) => void;
};

const COPY_ACTION: AgentAction = {
  key: 'copy',
  name: 'Copy as prompt',
  icon: CopyIcon,
  buttonIcon: TerminalWindowIcon,
  execute: (prompt) => {
    navigator.clipboard.writeText(prompt);
    toast.success('Task prompt copied to clipboard');
  },
};

const PLATFORM_ACTIONS: AgentAction[] = [
  {
    key: 'claude-code',
    name: 'Claude Code Web',
    icon: ClaudeIcon,
    execute: (prompt) =>
      window.open(
        `https://claude.ai/code?q=${encodeURIComponent(prompt)}`,
        '_blank'
      ),
  },
  {
    key: 'codex-desktop',
    name: 'Codex Desktop',
    icon: CodexIcon,
    execute: (prompt) =>
      window.open(`codex://new?prompt=${encodeURIComponent(prompt)}`, '_blank'),
  },
  {
    key: 'cursor',
    name: 'Cursor',
    icon: CursorIcon,
    execute: (prompt) =>
      window.open(
        `cursor://anysphere.cursor-deeplink/prompt?text=${encodeURIComponent(prompt)}`,
        '_blank'
      ),
  },
  {
    key: 'zed',
    name: 'Zed',
    icon: ZedIcon,
    execute: (prompt) =>
      window.open(`zed://agent?prompt=${encodeURIComponent(prompt)}`, '_blank'),
  },
];

const ALL_ACTIONS = [COPY_ACTION, ...PLATFORM_ACTIONS];

const [lastUsedKey, setLastUsedKey] = makePersisted(
  createSignal(COPY_ACTION.key),
  { name: LAST_USED_KEY }
);

export function useDispatchAgentAction() {
  const { documentId, state } = useMarkdownDocument();
  const blockId = documentId();
  const { displayName: name } = useMarkdownName();
  const discussionThreads = useDiscussionThreads();

  const lastUsed = () =>
    ALL_ACTIONS.find((a) => a.key === lastUsedKey()) ?? COPY_ACTION;

  const buildPrompt = createCallback(async () => {
    const docName = name() ?? '';
    const editor = state.editor.md.editor;
    const content = editor ? editorStateAsMarkdown(editor, 'external') : '';
    const threads = isFeatureEnabled(enableUnifiedDocumentDiscussions)
      ? await fetchMessagePromptThreads(blockId)
      : legacyPromptThreads(discussionThreads() ?? []);
    return generateTaskPrompt(blockId, docName, content, threads);
  });

  const executeAction = async (action: AgentAction) => {
    try {
      const prompt = await buildPrompt();
      action.execute(prompt);
      setLastUsedKey(action.key);
    } catch (e) {
      console.error('Failed to generate task prompt', e);
      toast.failure('Failed to generate task prompt');
    }
  };

  return {
    blockId,
    lastUsed,
    executeAction,
    executeLastUsed: () => executeAction(lastUsed()),
  };
}

export function useDispatchAgentSplitFileActions(): SplitFileMenuAction[] {
  const { executeAction } = useDispatchAgentAction();

  return [
    {
      label: COPY_ACTION.name,
      icon: COPY_ACTION.icon,
      action: () => {
        void executeAction(COPY_ACTION);
      },
    },
    ...PLATFORM_ACTIONS.map((action) => ({
      label: action.name,
      icon: action.icon,
      action: () => {
        void executeAction(action);
      },
    })),
    {
      label: 'MCP setup instructions',
      icon: PlugIcon,
      action: openMacroMcpSetupModal,
    },
  ];
}

export function DispatchAgentButton(
  props: { showPrimaryLabel?: boolean } = {}
) {
  const [open, setOpen] = createSignal(false);
  const { blockId, lastUsed, executeAction, executeLastUsed } =
    useDispatchAgentAction();

  return (
    <Dropdown open={open()} onOpenChange={setOpen}>
      <ButtonGroup
        variant="ghost"
        size={props.showPrimaryLabel ? 'sm' : 'icon-sm'}
        depth={2}
        class="rounded-full border border-edge-muted"
      >
        <Button
          onClick={executeLastUsed}
          tooltip={lastUsed().name}
          class="bg-transparent hover:bg-ink/[0.04]"
        >
          <Dynamic
            component={lastUsed().buttonIcon ?? lastUsed().icon}
            class="size-3!"
          />
          <Show when={props.showPrimaryLabel}>
            <span class="max-w-36 truncate text-xs font-medium">
              {lastUsed().name}
            </span>
          </Show>
        </Button>
        <ButtonGroup.Divider />
        <Dropdown.Trigger
          class="bg-transparent p-1 hover:bg-ink/[0.04]"
          label="Agent options"
        >
          <CaretDown class="size-3.5!" />
        </Dropdown.Trigger>
      </ButtonGroup>
      <Dropdown.Content>
        <Dropdown.Group>
          <Dropdown.Item
            onSelect={() => {
              executeAction(COPY_ACTION);
              setOpen(false);
            }}
          >
            <Dynamic component={COPY_ACTION.icon} class="size-4 shrink-0" />
            <span class="flex-1 truncate">{COPY_ACTION.name}</span>
          </Dropdown.Item>
          <Dropdown.Item
            onSelect={() => {
              copyBranchNameToClipboard(blockId);
              setOpen(false);
            }}
          >
            <GitBranch class="size-4 shrink-0" />
            <span class="flex-1 truncate">Copy branch name</span>
          </Dropdown.Item>
          <Dropdown.Item
            onSelect={() => {
              openMacroMcpSetupModal();
              setOpen(false);
            }}
          >
            <PlugIcon class="size-4 shrink-0" />
            <span class="flex-1 truncate">MCP setup instructions</span>
          </Dropdown.Item>
        </Dropdown.Group>
        <Dropdown.Group>
          <Dropdown.GroupLabel>Open in</Dropdown.GroupLabel>
          <For each={PLATFORM_ACTIONS}>
            {(action) => (
              <Dropdown.Item
                onSelect={() => {
                  executeAction(action);
                  setOpen(false);
                }}
              >
                <Dynamic component={action.icon} class="size-4 shrink-0" />
                <span class="flex-1 truncate">{action.name}</span>
              </Dropdown.Item>
            )}
          </For>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}
