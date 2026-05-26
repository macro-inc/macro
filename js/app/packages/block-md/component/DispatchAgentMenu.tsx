import { openMacroMcpSetupModal } from '@app/component/macro-mcp-setup-modal/MacroMcpSetupModal';
import { useBlockId } from '@core/block';
import { editorStateAsMarkdown } from '@core/component/LexicalMarkdown/utils';
import { toast } from '@core/component/Toast/Toast';
import { macroIdToEmail, tryMacroId } from '@core/user';
import { copyBranchNameToClipboard } from '@core/util/branchName';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
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
import type { CommentThread } from '@service-storage/generated/schemas/commentThread';
import { createCallback } from '@solid-primitives/rootless';
import { makePersisted } from '@solid-primitives/storage';
import { Button, ButtonGroup, Dropdown } from '@ui';
import { type Component, createSignal, For, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  discussionThreads,
  sortComments,
} from '../comments/discussionResource';
import { mdStore } from '../signal/markdownBlockData';

const LAST_USED_KEY = 'dispatch-agent-last-used';

async function generateTaskPrompt(
  documentId: string,
  documentName: string,
  content: string,
  threads: CommentThread[]
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
      const sorted = [...thread.comments].sort(sortComments);
      lines.push(`<comment-thread thread-id="${thread.thread.threadId}">`);
      for (const comment of sorted) {
        if (comment.text && !comment.deletedAt) {
          const userId = comment.sender ?? comment.owner;
          const macroId = tryMacroId(userId);
          const author = macroId ? macroIdToEmail(macroId) : userId;
          const createdAt = comment.createdAt
            ? ` created-at="${comment.createdAt}"`
            : '';
          lines.push(
            `<comment author="${author}"${createdAt}>${comment.text}</comment>`
          );
        }
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

export function DispatchAgentButton() {
  const blockId = useBlockId();
  const name = useBlockDocumentName();
  const [store] = mdStore;
  const [open, setOpen] = createSignal(false);

  const lastUsed = () =>
    ALL_ACTIONS.find((a) => a.key === lastUsedKey()) ?? COPY_ACTION;

  const buildPrompt = createCallback(() => {
    const docName = name();
    const content = store.editor
      ? editorStateAsMarkdown(store.editor, 'external')
      : '';
    const threads = discussionThreads() ?? [];
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
    setOpen(false);
  };

  const handlePrimaryClick = () => {
    executeAction(lastUsed());
  };

  return (
    <Dropdown open={open()} onOpenChange={setOpen}>
      <ButtonGroup variant="base" size="icon-sm" depth={2} class="bg-surface">
        <Button onClick={handlePrimaryClick} tooltip={lastUsed().name}>
          <Dynamic
            component={lastUsed().buttonIcon ?? lastUsed().icon}
            class="size-3!"
          />
        </Button>
        <ButtonGroup.Divider />
        <Dropdown.Trigger class="p-1">
          <CaretDown class="size-3.5!" />
        </Dropdown.Trigger>
      </ButtonGroup>
      <Dropdown.Content>
        <Dropdown.Group>
          <Dropdown.Item onSelect={() => executeAction(COPY_ACTION)}>
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
              <Dropdown.Item onSelect={() => executeAction(action)}>
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
