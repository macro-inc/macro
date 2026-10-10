import {
  $applyNodeReplacement,
  DecoratorNode,
  type DOMConversionMap,
  type EditorConfig,
  type EditorThemeClasses,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from 'lexical';
import { type DecoratorComponent, getDecorator } from '../decoratorRegistry';
import { $applyIdFromSerialized } from '../plugins/nodeIdPlugin';

const VERSION = 1;

export const AGENT_ACTIVITY_NODE_TYPE = 'agent-activity';

/** Where one step of an agent's work got to. */
export const AGENT_ACTIVITY_STATUSES = [
  'running',
  'completed',
  'failed',
  'interrupted',
] as const;

/** Where one step of an agent's work got to. */
export type AgentActivityStatus = (typeof AGENT_ACTIVITY_STATUSES)[number];

/** The kinds of workspace item a step's card opens. */
export const AGENT_ACTIVITY_CARD_ITEM_TYPES = [
  'document',
  'email_thread',
  'calendar_event',
] as const;

/** What a step did to the item its card opens. */
export const AGENT_ACTIVITY_CARD_ACTIONS = [
  'created',
  'edited',
  'sent',
] as const;

/**
 * Something a step produced, shown as a card after the steps of its run: a
 * workspace item it created, changed or sent, or a view the agent composed
 * for the user. The same shape the session's fold gives its rows.
 */
export type AgentActivityCard =
  | {
      kind: 'item';
      itemType: (typeof AGENT_ACTIVITY_CARD_ITEM_TYPES)[number];
      itemId: string;
      /** A document's file type, when the step named it. */
      fileType?: string | null;
      action: (typeof AGENT_ACTIVITY_CARD_ACTIONS)[number];
      /** The item's name as the step knew it, until the item loads. */
      title?: string | null;
    }
  | {
      kind: 'view';
      /** A dynamic-UI view, validated where it renders. */
      view: unknown;
    };

/** One step of work as the agent session's fold worded it. */
export type AgentActivityRow = {
  id: string;
  label: string;
  detail?: string;
  status: AgentActivityStatus;
  /**
   * What the step produced. A card this version cannot read is kept but not
   * shown, so a newer server's cards never invalidate the steps.
   */
  card?: AgentActivityCard | null;
};

const isOptionalText = (value: unknown) =>
  value === undefined || value === null || typeof value === 'string';

/** Return whether a value is a card this version knows how to show. */
export function isAgentActivityCard(
  value: unknown
): value is AgentActivityCard {
  if (!value || typeof value !== 'object') return false;
  const card = value as Record<string, unknown>;
  if (card.kind === 'view') return 'view' in card;
  return (
    card.kind === 'item' &&
    (AGENT_ACTIVITY_CARD_ITEM_TYPES as readonly unknown[]).includes(
      card.itemType
    ) &&
    typeof card.itemId === 'string' &&
    card.itemId.length > 0 &&
    (AGENT_ACTIVITY_CARD_ACTIONS as readonly unknown[]).includes(card.action) &&
    isOptionalText(card.fileType) &&
    isOptionalText(card.title)
  );
}

/**
 * The steps an agent took between two passages of a reply: the activity
 * segment `segment` of the reply to `turn` in `agentSessionId`.
 *
 * `rows` is the snapshot the server wrote when it last posted the message: what
 * a reader without access to the session, a notification, or search sees. A
 * viewer who can read the session renders the same segment live instead.
 */
export type AgentActivityData = {
  agentSessionId: string;
  turn: number;
  segment: number;
  rows: AgentActivityRow[];
  /** Whether the segment can still gain steps. */
  sealed: boolean;
};

export type SerializedAgentActivityNode = Spread<
  AgentActivityData,
  SerializedLexicalNode
>;

export type AgentActivityDecoratorProps = AgentActivityData & {
  key: NodeKey;
  theme: EditorThemeClasses;
};

export function isAgentActivityStatus(
  value: unknown
): value is AgentActivityStatus {
  return (AGENT_ACTIVITY_STATUSES as readonly unknown[]).includes(value);
}

function isAgentActivityRow(value: unknown): value is AgentActivityRow {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === 'string' &&
    typeof row.label === 'string' &&
    (row.detail === undefined || typeof row.detail === 'string') &&
    isAgentActivityStatus(row.status) &&
    (row.card === undefined ||
      row.card === null ||
      typeof row.card === 'object')
  );
}

const isIndex = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

/** Return whether a value is a well-formed activity payload. */
export function isAgentActivityData(
  value: unknown
): value is AgentActivityData {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  return (
    typeof data.agentSessionId === 'string' &&
    isIndex(data.turn) &&
    isIndex(data.segment) &&
    Array.isArray(data.rows) &&
    data.rows.every(isAgentActivityRow) &&
    typeof data.sealed === 'boolean'
  );
}

/** A plain-text line for each step: how the activity reads when copied. */
export function agentActivityText(rows: readonly AgentActivityRow[]): string {
  return rows
    .map((row) => (row.detail ? `${row.label} ${row.detail}` : row.label))
    .join('\n');
}

/** The steps of an agent reply, rendered live where the session is readable. */
export class AgentActivityNode extends DecoratorNode<
  DecoratorComponent<AgentActivityDecoratorProps> | undefined
> {
  __data: AgentActivityData;

  __cachedDecoratorSignature?: string;
  __cachedDecoratorComponent?: DecoratorComponent<AgentActivityDecoratorProps>;

  static getType() {
    return AGENT_ACTIVITY_NODE_TYPE;
  }

  static clone(node: AgentActivityNode) {
    const clone = new AgentActivityNode(node.__data, node.__key);
    clone.__cachedDecoratorSignature = node.__cachedDecoratorSignature;
    clone.__cachedDecoratorComponent = node.__cachedDecoratorComponent;
    return clone;
  }

  constructor(data: AgentActivityData, key?: NodeKey) {
    super(key);
    this.__data = data;
  }

  isInline(): boolean {
    return false;
  }

  isKeyboardSelectable(): boolean {
    return false;
  }

  static importJSON(serializedNode: SerializedAgentActivityNode) {
    const node = $createAgentActivityNode({
      agentSessionId: serializedNode.agentSessionId,
      turn: serializedNode.turn,
      segment: serializedNode.segment,
      rows: serializedNode.rows,
      sealed: serializedNode.sealed,
    });
    $applyIdFromSerialized(node, serializedNode);
    return node;
  }

  exportJSON(): SerializedAgentActivityNode {
    return {
      ...super.exportJSON(),
      ...this.exportComponentProps(),
      type: AGENT_ACTIVITY_NODE_TYPE,
      version: VERSION,
    };
  }

  exportComponentProps(): AgentActivityData {
    return this.__data;
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const element = document.createElement('div');
    element.setAttribute('data-agent-activity', this.__data.agentSessionId);
    return element;
  }

  updateDOM(): boolean {
    return false;
  }

  exportDOM() {
    const element = document.createElement('div');
    element.setAttribute('data-agent-activity', this.__data.agentSessionId);
    element.textContent = agentActivityText(this.__data.rows);
    return { element };
  }

  static importDOM(): DOMConversionMap | null {
    return null;
  }

  // Steps are not prose: a preview, a notification, or a search hit for an
  // agent's reply quotes what it wrote, not every command it ran.
  getTextContent(): string {
    return '';
  }

  decorate(_: LexicalEditor, config: EditorConfig) {
    const signature = JSON.stringify(this.__data);
    if (
      this.__cachedDecoratorComponent &&
      this.__cachedDecoratorSignature === signature
    )
      return this.__cachedDecoratorComponent;
    this.__cachedDecoratorSignature = signature;
    const decorator =
      getDecorator<AgentActivityDecoratorProps>(AgentActivityNode);
    if (decorator) {
      this.__cachedDecoratorComponent = () =>
        decorator({
          ...this.__data,
          key: this.getKey(),
          theme: config.theme,
        });
      return this.__cachedDecoratorComponent;
    }
  }
}

/** Create an agent activity node. */
export function $createAgentActivityNode(
  data: AgentActivityData
): AgentActivityNode {
  return $applyNodeReplacement(new AgentActivityNode(data));
}

/** Return whether a Lexical node is an agent activity node. */
export function $isAgentActivityNode(
  node: LexicalNode | null | undefined
): node is AgentActivityNode {
  return node instanceof AgentActivityNode;
}
