import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import { fireAndForget } from '@core/util/fireAndForget';
import TagIcon from '@phosphor/tag-simple.svg';
import { navigateToTag } from '@property/tags/tagNavigation';
import { queryReadyGate } from '@queries/gate';
import { useTagsQuery } from '@queries/properties/tags';
import { badgeClasses, cn, TagDot } from '@ui';
import { createMemo, For, Show } from 'solid-js';
import {
  type KnownTag,
  ontologyRows,
  type TagRowView,
} from '../core/tag-ontology';
import type { OntologyTag } from '../core/types';
import {
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  CardHiddenCount,
} from './kit/card';
import { CardRow, Tile } from './kit/parts';

/** Past this many tags the card holds a fixed height and says what is below. */
const TAG_ROWS = 8;

function countRows(rows: readonly TagRowView[]): number {
  return rows.reduce((total, row) => total + 1 + countRows(row.children), 0);
}

/**
 * Tags as coloured pills, each with what it is for, and the narrower tags
 * under it on a guide line, to any depth.
 */
export function TagsCardView(props: {
  title?: string;
  rows: readonly TagRowView[];
}) {
  const title = () => props.title || 'Tags';
  const count = createMemo(() => countRows(props.rows));
  return (
    <Card
      width="standard"
      height={count() > TAG_ROWS ? 320 : 'auto'}
      data-agent-card="tags"
    >
      <section aria-label={title()} class="flex min-h-0 flex-1 flex-col">
        <CardHeader
          center
          tile={
            <Tile size={32}>
              <TagIcon />
            </Tile>
          }
          title={title()}
          subtitle={`${count()} ${count() === 1 ? 'tag' : 'tags'}`}
        />
        <CardBody tight>
          <Show
            when={count() > 0}
            fallback={
              <p class="px-1.5 py-2 text-xs text-ink-muted">No tags.</p>
            }
          >
            <TagList rows={props.rows} />
          </Show>
        </CardBody>
        <Show when={count() > TAG_ROWS}>
          <CardFooter small>
            <CardHiddenCount total={count()} noun="tags" />
          </CardFooter>
        </Show>
      </section>
    </Card>
  );
}

function TagList(props: { rows: readonly TagRowView[]; nested?: boolean }) {
  return (
    <ul
      class={cn(
        'flex min-w-0 flex-col gap-0.5',
        props.nested && 'ml-[18px] border-l border-edge-muted pl-1'
      )}
    >
      <For each={props.rows}>
        {(row) => (
          <li class="min-w-0">
            <CardRow top onClick={row.onOpen} class="py-1">
              <span
                class={badgeClasses({
                  variant: 'outline',
                  size: 'xs',
                  class: 'max-w-[60%] min-w-0 shrink text-ink',
                })}
              >
                <TagDot fills={row.fills} />
                <span class="min-w-0 truncate">{row.label}</span>
              </span>
              <Show when={row.description}>
                <span class="line-clamp-2 min-w-0 flex-1 pt-0.5 text-xs leading-4 text-ink-muted">
                  {row.description}
                </span>
              </Show>
            </CardRow>
            <Show when={row.children.length > 0}>
              <TagList rows={row.children} nested />
            </Show>
          </li>
        )}
      </For>
    </ul>
  );
}

/**
 * An ontology of tags, nested as it nests. A tag the viewer has shows its
 * current name and colour and opens what is tagged with it; any other shows
 * as the agent wrote it.
 */
export function TagsCard(props: {
  title?: string;
  tags: readonly OntologyTag[];
}) {
  const tagsQuery = useTagsQuery();
  const split = useSplitLayout();
  const panel = useSplitPanel();
  const known = createMemo(() => {
    const byId = new Map<string, KnownTag>();
    // Read only once loaded: a pending read suspends the view the tags sit
    // in, which blanks it until they arrive. Until then every tag shows as
    // the agent wrote it.
    const sets = queryReadyGate(tagsQuery) ? tagsQuery.data : [];
    for (const set of sets) {
      for (const option of set.options) {
        const target = {
          optionId: option.id,
          propertyDefinitionId: option.propertyDefinitionId,
        };
        byId.set(option.id, {
          label:
            option.value.type === 'string' ? option.value.value : option.id,
          color: option.color ?? undefined,
          open: () =>
            fireAndForget(
              navigateToTag(split.openWithSplit, target, {
                handle: panel?.handle,
              }),
              'agent-cards'
            ),
        });
      }
    }
    return byId;
  });
  const rows = createMemo(() =>
    ontologyRows(props.tags, (tagId) => known().get(tagId))
  );
  return <TagsCardView title={props.title} rows={rows()} />;
}
