import { ListHeader } from '@app/components/view-shell/ListHeader';
import type { JSX } from 'solid-js';

export type SectionHeaderProps = {
  title: JSX.Element;
  actions?: JSX.Element;
};

/** One header row: title (and view tabs) on the left, actions on the right. */
export function SectionHeader(props: SectionHeaderProps) {
  return <ListHeader title={props.title}>{props.actions}</ListHeader>;
}
