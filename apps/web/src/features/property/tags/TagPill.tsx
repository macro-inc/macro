import { badgeTriggerClasses, cn } from '@ui';
import { TagDot } from './TagDot';
import { TagPicker, type TagPickerSourceProps } from './TagPicker';
import type { ResolvedTag } from './useDocTags';

export type TagPillProps = TagPickerSourceProps & {
  tag: ResolvedTag;
  replaceTag?: ResolvedTag;
  class?: string;
  dotClass?: string;
  triggerLabel?: string;
  onOpenChange?: (open: boolean) => void;
  withClickBlock?: boolean;
};

/** Canonical classes for an interactive tag pill. */
export function tagPillClasses(className?: string): string {
  return badgeTriggerClasses({
    variant: 'outline',
    size: 'sm',
    class: cn('min-w-0 text-ink-muted transition-colors', className),
  });
}

/** A tag-owned picker trigger with the shared Badge visual contract. */
export function TagPill(props: TagPillProps) {
  const sourceProps = (): TagPickerSourceProps =>
    props.docTags
      ? { docTags: props.docTags }
      : { createDocTags: props.createDocTags };

  return (
    <TagPicker
      {...sourceProps()}
      replaceTag={props.replaceTag}
      triggerClass={tagPillClasses(props.class)}
      triggerLabel={
        props.triggerLabel ?? `Change or select tag ${props.tag.label}`
      }
      onOpenChange={props.onOpenChange}
      withClickBlock={props.withClickBlock}
    >
      <TagDot color={props.tag.color} class={props.dotClass} />
      <span class="min-w-0 truncate">{props.tag.label}</span>
    </TagPicker>
  );
}
