import {
  DEFAULT_TAG_COLOR,
  optionColorOf,
  TAG_COLOR_OPTIONS,
} from '@app/features/property/tags/tagColors';
import type { OntologyTag } from './types';

/** A tag the viewer has, as an ontology shows it. */
export type KnownTag = {
  label: string;
  color?: string;
  /** Opens what is tagged with it. */
  open: (event: MouseEvent) => void;
};

/** One tag of an ontology as its card shows it, with the tags under it. */
export type TagRowView = {
  key: string;
  label: string;
  /** The tag's own colour first, then those of the tags under it. */
  fills: string[];
  description?: string;
  /** Opens what is tagged with it, for a tag the viewer has. */
  onOpen?: (event: MouseEvent) => void;
  children: TagRowView[];
};

/**
 * A colour as an agent wrote it - a palette name or hex, in any case - as the
 * palette's hex. Anything else is no colour.
 */
export function paletteColor(color: string | undefined): string | undefined {
  const wanted = color?.trim().toLowerCase();
  if (!wanted) return undefined;
  return (
    TAG_COLOR_OPTIONS.find((option) => option.name.toLowerCase() === wanted)
      ?.color ?? optionColorOf(wanted)?.color
  );
}

/**
 * The rows of an ontology, nested as it nests. A tag the viewer has shows its
 * current name and colour; any other shows as the agent wrote it. A narrower
 * tag leaves out the path its parent already shows: `Type/bug` under `Type`
 * reads `bug`. A tag with no colour is gray, and a branch's dot sums up the
 * colours under it, as the sidebar's tag tree does.
 */
export function ontologyRows(
  tags: readonly OntologyTag[],
  known: (tagId: string) => KnownTag | undefined,
  parent?: { label: string; key: string }
): TagRowView[] {
  return tags.map((tag, index) => {
    const existing = tag.tagId ? known(tag.tagId) : undefined;
    const label = existing?.label ?? tag.label;
    const key = parent ? `${parent.key}.${index}` : `${index}`;
    const children = ontologyRows(tag.children ?? [], known, { label, key });
    const color = existing ? existing.color : paletteColor(tag.color);
    const own =
      color ?? (children.length === 0 ? DEFAULT_TAG_COLOR : undefined);
    return {
      key,
      label:
        parent && label.startsWith(`${parent.label}/`)
          ? label.slice(parent.label.length + 1)
          : label,
      fills: [
        ...(own ? [own] : []),
        ...children.flatMap((child) => child.fills),
      ],
      description: tag.description,
      onOpen: existing?.open,
      children,
    };
  });
}
