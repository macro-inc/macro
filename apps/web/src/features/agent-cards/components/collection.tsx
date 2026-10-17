import {
  EntityIcon,
  type EntityIconSelector,
} from '@core/component/EntityIcon';
import { For, type ParentProps, Show } from 'solid-js';
import {
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  CardHiddenCount,
} from './kit/card';
import { CardGroupHeader, CardPill, Skeleton, Tile } from './kit/parts';

/** A collection longer than this holds a fixed height and says what is below. */
const COLLECTION_ROWS = 5;

/**
 * Many items at once, in one card: a header that says what they are and
 * how many, the rows, and - past five rows - a fixed height with "N more
 * below" and "Show all". The rows are the caller's; each one marks itself
 * `data-card-row` so the card can count what it hides.
 */
export function CollectionCard(
  props: ParentProps<{
    title: string;
    /** `4 results`, `Grouped by date`. */
    subtitle?: string;
    /** The icon of what the rows are, or `files` for a mix. */
    icon?: EntityIconSelector;
    /** How many rows the card holds. */
    count: number;
    /** What the rows are, for the count: `items`, `tasks`. */
    noun?: string;
    /** The rows come from a query and keep updating. */
    live?: boolean;
    state: 'loading' | 'ready';
  }>
) {
  return (
    <Card
      width="standard"
      height={
        props.state === 'loading'
          ? 160
          : props.count > COLLECTION_ROWS
            ? 320
            : 'auto'
      }
      data-agent-card="collection"
    >
      <section
        aria-label={props.title}
        aria-busy={props.state === 'loading'}
        class="flex min-h-0 flex-1 flex-col"
      >
        <CardHeader
          center
          tile={
            <Tile size={32}>
              <EntityIcon targetType={props.icon ?? 'files'} size="sm" />
            </Tile>
          }
          title={props.title}
          subtitle={props.subtitle}
          trailing={
            <Show when={props.live}>
              <CardPill tone="ok">
                <span
                  class="size-1.5 rounded-full bg-current"
                  aria-hidden="true"
                />
                Live
              </CardPill>
            </Show>
          }
        />
        <CardBody tight>
          <Show when={props.state === 'ready'} fallback={<SkeletonRows />}>
            <Show
              when={props.count > 0}
              fallback={
                <p class="px-1.5 py-2 text-xs text-ink-muted">
                  Nothing matches.
                </p>
              }
            >
              {props.children}
            </Show>
          </Show>
        </CardBody>
        <Show when={props.state === 'ready' && props.count > COLLECTION_ROWS}>
          <CardFooter small>
            <CardHiddenCount total={props.count} noun={props.noun} />
          </CardFooter>
        </Show>
      </section>
    </Card>
  );
}

/** One group of a collection's rows, under its small-caps header. */
export function CollectionGroup(props: ParentProps<{ label: string }>) {
  return (
    <div role="group" aria-label={props.label}>
      <CardGroupHeader>{props.label}</CardGroupHeader>
      {props.children}
    </div>
  );
}

/** Rows that hold the card's height while what fills them loads. */
function SkeletonRows() {
  return (
    <div class="flex flex-col gap-3.5 px-1.5 pt-2">
      <For each={['55%', '70%', '45%']}>
        {(width) => (
          <span class="flex items-center gap-2">
            <Skeleton width="16px" height="16px" />
            <Skeleton width={width} />
          </span>
        )}
      </For>
    </div>
  );
}
