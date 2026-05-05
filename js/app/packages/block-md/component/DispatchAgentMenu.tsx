import { useBlockId } from '@core/block';
import { toast } from '@core/component/Toast/Toast';
import { DropdownMenuContent, MenuItem } from '@core/component/Menu';
import { editorStateAsMarkdown } from '@core/component/LexicalMarkdown/utils';
import { isOk } from '@core/util/maybeResult';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { tryMacroId, macroIdToEmail } from '@core/user';
import { storageServiceClient } from '@service-storage/client';
import { mdStore } from '../signal/markdownBlockData';
import {
  discussionThreads,
  sortComments,
} from '../comments/discussionResource';
import { makePersisted } from '@solid-primitives/storage';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import { Button } from '@ui/components/Button';
import { createSignal, For, type Component, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import CaretDown from '@icon/regular/caret-down.svg';
import CopyIcon from '@icon/regular/copy.svg';
import TerminalWindowIcon from '@icon/regular/terminal-window.svg';
import ClaudeIcon from '@macro-icons/wide/claude.svg';
import CursorIcon from '@macro-icons/wide/cursor-ide.svg';
import ZedIcon from '@macro-icons/wide/zed-ide.svg';
import CodexIcon from '@macro-icons/wide/codex-ide.svg';
import type { CommentThread } from '@service-storage/generated/schemas/commentThread';
import { createCallback } from '@solid-primitives/rootless';
import { openMacroMcpSetupModal } from '@app/component/macro-mcp-setup-modal/MacroMcpSetupModal';
import PlugIcon from '@icon/regular/plug.svg';

const MAX_BRANCH_LENGTH = 200;
const LAST_USED_KEY = 'dispatch-agent-last-used';

const slugify = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

async function buildBranchName(
  documentId: string,
  documentName: string
): Promise<{ shortId: string; branchName: string }> {
  const result = await storageServiceClient.getDocumentShortId({ documentId });
  const shortId = isOk(result) ? result[1] : documentId;
  const slug = slugify(documentName);
  const branchName = `macro-${shortId}${slug ? `-${slug}` : ''}`.slice(
    0,
    MAX_BRANCH_LENGTH
  );
  return { shortId, branchName };
}

async function generateTaskPrompt(
  documentId: string,
  documentName: string,
  content: string,
  threads: CommentThread[]
): Promise<string> {
  const { shortId, branchName } = await buildBranchName(
    documentId,
    documentName
  );

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
    <DropdownMenu open={open()} onOpenChange={setOpen}>
      <div class="border border-edge-muted flex ml-1 items-stretch rounded-xs">
        <Button
          onClick={handlePrimaryClick}
          tooltip={lastUsed().name}
          variant="ghost"
          size="icon-sm"
          class="p-1"
        >
          <Dynamic
            component={lastUsed().buttonIcon ?? lastUsed().icon}
            class="size-3.5"
          />
        </Button>
        <div class="w-px bg-edge-muted" />
        <DropdownMenu.Trigger
          as={Button}
          variant="ghost"
          size="icon-sm"
          class="p-1"
        >
          <CaretDown class="w-3 h-3" />
        </DropdownMenu.Trigger>
      </div>
      <DropdownMenu.Portal>
        <DropdownMenuContent>
          <MenuItem
            text={COPY_ACTION.name}
            icon={COPY_ACTION.icon}
            onClick={() => executeAction(COPY_ACTION)}
          />
          <MenuItem
            text="MCP setup instructions"
            icon={PlugIcon}
            onClick={() => {
              openMacroMcpSetupModal();
              setOpen(false);
            }}
          />
          <div class="my-1 h-px bg-edge-muted" />
          <div class="px-2 py-1 text-xs text-ink-extra-muted font-medium">
            Open in
          </div>
          <For each={PLATFORM_ACTIONS}>
            {(action) => (
              <MenuItem
                text={action.name}
                icon={action.icon}
                onClick={() => executeAction(action)}
              />
            )}
          </For>
        </DropdownMenuContent>
      </DropdownMenu.Portal>
    </DropdownMenu>
  );
}
