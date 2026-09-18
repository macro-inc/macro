import { TagDot as UiTagDot } from '@ui';
import { DEFAULT_TAG_COLOR } from './tagColors';

export function TagDot(props: { color?: string; class?: string }) {
  return (
    <UiTagDot fill={props.color ?? DEFAULT_TAG_COLOR} class={props.class} />
  );
}
