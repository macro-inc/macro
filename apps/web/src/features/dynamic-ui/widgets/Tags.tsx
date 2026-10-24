import { TagsCard } from '@app/features/agent-cards/components/tags-card';
import type { WidgetOf } from '../schema';

export type TagsProps = Omit<WidgetOf<'tags'>, 'type'>;

/** An ontology of tags as coloured pills, nested to any depth. */
export function Tags(props: TagsProps) {
  return <TagsCard title={props.title} tags={props.tags} />;
}
