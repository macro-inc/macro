import { type Intent, rankIntents, type Scores } from './input';

/**
 * Marks an element whose rendered text can be handed to Universal Input. A
 * surface opts in by naming itself in the attribute, which also tells the
 * offer and its telemetry which surface the text came from.
 */
export const SELECTION_OFFER_ATTRIBUTE = 'data-selection-offer';

/**
 * Shapes worth offering for text that is already on screen. `ai` and `search`
 * answer a question the reader has not asked, and `email` and `message` need a
 * recipient the selected text cannot supply; Command K covers all four.
 */
export const OFFERED_INTENTS: readonly Intent[] = ['calendar', 'task', 'note'];

/** Fewer words than this carry no shape to recognize. */
const MINIMUM_WORDS = 4;
/** Past this the reader is copying a passage, not capturing a thought. */
const MAXIMUM_CHARACTERS = 1000;
/** Each shape is scored on its own, so a weak winner means "none of these". */
const OFFERED_SCORE = 0.6;

export type SelectedText = {
  text: string;
  /** The opting-in surface's name, e.g. `channel-message`. */
  surface: string;
  container: HTMLElement;
};

/** The part of `Selection` the rules read, so they can be exercised without a caret. */
export type ReadableSelection = Pick<
  Selection,
  'isCollapsed' | 'anchorNode' | 'focusNode'
> & { toString(): string };

function offerContainer(node: Node): HTMLElement | undefined {
  let current: Node | null = node;
  while (current) {
    const element = current instanceof Element ? current : current.parentElement;
    const container = element?.closest<HTMLElement>(
      `[${SELECTION_OFFER_ATTRIBUTE}]`
    );
    if (container) return container;
    // Email bodies render inside a shadow root, which closest() will not
    // leave; step out through its host and keep looking.
    const root = current.getRootNode();
    current = root instanceof ShadowRoot ? root.host : null;
  }
  return undefined;
}

export function offerableText(text: string): boolean {
  return (
    text.length <= MAXIMUM_CHARACTERS &&
    text.split(/\s+/).filter(Boolean).length >= MINIMUM_WORDS
  );
}

/**
 * The selected text, when it is one passage of one opted-in surface. A drag
 * that starts in one message and ends in the next is a copy, not a thought.
 */
export function readSelectedText(
  selection: ReadableSelection | null | undefined
): SelectedText | undefined {
  if (!selection || selection.isCollapsed) return;
  const { anchorNode, focusNode } = selection;
  if (!anchorNode || !focusNode) return;
  const container = offerContainer(anchorNode);
  if (!container || offerContainer(focusNode) !== container) return;
  const text = selection.toString().trim();
  if (!offerableText(text)) return;
  return {
    text,
    surface: container.getAttribute(SELECTION_OFFER_ATTRIBUTE) || 'unknown',
    container,
  };
}

/** The shape to offer, or nothing when the reader is better left alone. */
export function offeredIntent(scores: Scores): Intent | undefined {
  const top = rankIntents(scores)[0];
  if (!top || top.score < OFFERED_SCORE) return;
  return OFFERED_INTENTS.includes(top.intent) ? top.intent : undefined;
}
