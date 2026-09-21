/**
 * How a tool call reads in its row: a glyph for what kind of work it was, and
 * the verb for what it did.
 *
 * A harness names its tools after their implementation — `Bash`,
 * `str_replace_editor`, `codebase_search` — and the fold has already sorted
 * those names into the handful of kinds a reader cares about. So for a kind
 * the fold recognizes, the row says what happened ("Ran", "Edited") and the
 * tool's own name is noise. The kinds the fold cannot name that way — Macro's
 * own tools, an MCP server's, a harness tool this block does not model — keep
 * their name as the title, because the name is all that identifies them.
 */

import ArrowsLeftRight from '@phosphor/arrows-left-right.svg';
import Brain from '@phosphor/brain.svg';
import FileText from '@phosphor/file-text.svg';
import Globe from '@phosphor/globe.svg';
import MagnifyingGlass from '@phosphor/magnifying-glass.svg';
import NotePencil from '@phosphor/note-pencil.svg';
import PencilSimple from '@phosphor/pencil-simple.svg';
import Plug from '@phosphor/plug.svg';
import Sparkle from '@phosphor/sparkle.svg';
import Terminal from '@phosphor/terminal.svg';
import Trash from '@phosphor/trash.svg';
import UsersThree from '@phosphor/users-three.svg';
import type { ToolDetail } from '@service-agent-fold/generated/types';
import type { JSX } from 'solid-js';

type ToolKind = ToolDetail['kind'];

type Appearance = {
  icon: (props: { class?: string }) => JSX.Element;
  /** What the row reads while the call runs and once it is over. */
  verbs?: { active: string; done: string };
};

const APPEARANCE: Record<ToolKind, Appearance> = {
  terminal: { icon: Terminal, verbs: { active: 'Running', done: 'Ran' } },
  edit: { icon: PencilSimple, verbs: { active: 'Editing', done: 'Edited' } },
  read: { icon: FileText, verbs: { active: 'Reading', done: 'Read' } },
  delete: { icon: Trash, verbs: { active: 'Deleting', done: 'Deleted' } },
  move: { icon: ArrowsLeftRight, verbs: { active: 'Moving', done: 'Moved' } },
  search: {
    icon: MagnifyingGlass,
    verbs: { active: 'Searching', done: 'Searched' },
  },
  fetch: { icon: Globe, verbs: { active: 'Fetching', done: 'Fetched' } },
  think: { icon: Brain, verbs: { active: 'Thinking', done: 'Thought' } },
  subagent: { icon: UsersThree },
  macro: { icon: Sparkle },
  user_tool: { icon: NotePencil },
  other: { icon: Plug },
};

/** The glyph for a call of this kind, sized for the card row. */
export function toolIcon(kind: ToolKind): JSX.Element {
  const Icon = APPEARANCE[kind].icon;
  return <Icon class="size-3.5" />;
}

/**
 * What the row calls a tool of this kind: the past-tense verb and the one it
 * shows while the call is still running, or `undefined` for a kind that keeps
 * the tool's own name.
 */
export function toolVerbs(
  kind: ToolKind
): { active: string; done: string } | undefined {
  return APPEARANCE[kind].verbs;
}
