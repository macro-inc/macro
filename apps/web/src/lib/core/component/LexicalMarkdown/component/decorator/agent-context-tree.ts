import { match } from 'ts-pattern';

/** One element of an agent's context, as the XML has it. */
export type ContextElement = {
  tag: string;
  attributes: [name: string, value: string][];
  /** Guidance the agent was given about this element. */
  notes: string[];
  /** Text of an element without element children. */
  text: string | undefined;
  children: ContextElement[];
};

function toElement(element: Element): ContextElement {
  const children = [...element.children];
  return {
    tag: element.tagName,
    attributes: [...element.attributes].map((item) => [item.name, item.value]),
    notes: children
      .filter((child) => child.tagName === 'note')
      .map((child) => child.textContent ?? ''),
    text:
      children.length === 0
        ? element.textContent?.trim() || undefined
        : undefined,
    children: children
      .filter((child) => child.tagName !== 'note')
      .map(toElement),
  };
}

/** Top-level elements, or `undefined` when the text is not XML. */
export function parseContext(text: string): ContextElement[] | undefined {
  const parsed = new DOMParser().parseFromString(
    `<context>${text}</context>`,
    'application/xml'
  );
  if (parsed.getElementsByTagName('parsererror').length > 0) return undefined;
  return [...parsed.documentElement.children].map(toElement);
}

export function attributeOf(
  element: ContextElement,
  name: string
): string | undefined {
  return element.attributes.find(([key]) => key === name)?.[1];
}

function findFirst(
  elements: ContextElement[],
  tags: string[]
): ContextElement | undefined {
  for (const element of elements) {
    if (tags.includes(element.tag)) return element;
    const found = findFirst(element.children, tags);
    if (found) return found;
  }
  return undefined;
}

const PLACE_TAGS = [
  'channel',
  'document',
  'task',
  'routine',
  'project',
  'call',
];

/** Where the trigger happened, as a reader names it: `#eng`, a document's name. */
export function placeOf(trigger: ContextElement): string | undefined {
  const place = findFirst([trigger], PLACE_TAGS);
  if (!place) return undefined;
  const name = attributeOf(place, 'name') ?? attributeOf(place, 'title');
  if (!name) return undefined;
  return place.tag === 'channel' ? `#${name}` : name;
}

/** The chip's label: what called the agent, and where. */
export function summaryOf(elements: ContextElement[]): string {
  const trigger = elements.find((element) => element.tag === 'trigger');
  if (!trigger) return 'Context';
  const kind = match(attributeOf(trigger, 'kind'))
    .with('mentioned', () => 'Mentioned')
    .with('follow_up', () => 'Follow-up')
    .with('task_assigned', () => 'Task assigned')
    .with('requested', () => 'Requested')
    .with('dispatched', () => 'Dispatched')
    .with('routine', () => 'Routine')
    .otherwise(() => 'Context');
  const place = placeOf(trigger);
  return place ? `${kind} · ${place}` : kind;
}

/** Times in the context are RFC 3339; show them the way the app does. */
export function displayValue(name: string, value: string): string {
  if (name !== 'at' && name !== 'due' && !name.endsWith('_at')) return value;
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? value : time.toLocaleString();
}
