import { EntityIcon } from '@core/component/EntityIcon';
import { useItemPreviewData } from '@core/component/ItemPreview';
import { openExternalUrl } from '@core/util/url';
import CaretUp from '@phosphor/caret-up.svg';
import Globe from '@phosphor/globe-simple.svg';
import { isAccessiblePreviewItem } from '@queries/preview/types';
import { proxiedResourceUrl } from '@queries/unfurl/resource';
import { cn } from '@ui';
import { createSignal, For, type JSX, Show } from 'solid-js';
import { itemKind } from '../core/labels';
import {
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  CardHiddenCount,
} from './kit/card';
import { CardRow, Tile } from './kit/parts';
import {
  fallbackIcon,
  type LoadableType,
  OpenArrow,
  PREVIEW_TYPES,
} from './reference-card';

/** Something an answer rests on: a web page, or a workspace item by id. */
export type SourceRef =
  | { kind: 'web'; url: string; title?: string | null }
  | { kind: 'item'; itemType: LoadableType; itemId: string };

/** A sources list longer than this holds a fixed height. */
const SOURCE_ROWS = 5;

/** How many sources the pill shows a face for. */
const PILL_FACES = 4;

/** `lumen.example` from `https://www.lumen.example/blog`. */
export function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** A site's icon, fetched through Macro's proxy, or a globe when it has none. */
function Favicon(props: { url: string; class?: string }) {
  const [failed, setFailed] = createSignal(false);
  const icon = () => {
    try {
      return proxiedResourceUrl(`${new URL(props.url).origin}/favicon.ico`);
    } catch {
      return undefined;
    }
  };
  return (
    <Show
      when={!failed() && icon()}
      fallback={
        <Globe
          class={cn('flex-none text-ink-subtle', props.class)}
          aria-hidden="true"
        />
      }
    >
      {(src) => (
        <img
          src={src()}
          alt=""
          class={cn('flex-none rounded-sm object-contain', props.class)}
          on:error={() => setFailed(true)}
        />
      )}
    </Show>
  );
}

function SourceFace(props: { source: SourceRef }) {
  return (
    <span class="-ml-1.5 flex size-5 flex-none items-center justify-center rounded-full border border-panel bg-panel first:ml-0">
      <Show
        when={props.source.kind === 'web' && props.source}
        fallback={
          <Show when={props.source.kind === 'item' && props.source}>
            {(item) => (
              <EntityIcon
                targetType={fallbackIcon(item().itemType)}
                size="xs"
              />
            )}
          </Show>
        }
      >
        {(web) => <Favicon url={web().url} class="size-3.5" />}
      </Show>
    </span>
  );
}

/**
 * What an answer rests on, folded to one pill: a few of the sources' faces
 * and how many there are. It opens into the list.
 */
export function SourcesPill(props: {
  sources: readonly SourceRef[];
  total: number;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      data-agent-card="sources"
      class="inline-flex h-7 max-w-full items-center gap-2 self-start rounded-full border border-edge-muted bg-panel pr-3 pl-1.5 text-xs text-ink-muted transition-colors not-touch:hover:border-edge not-touch:hover:bg-hover not-touch:hover:text-ink"
      onClick={() => props.onOpen()}
      aria-label={`Show ${props.total} sources`}
    >
      <span class="flex items-center" aria-hidden="true">
        <For each={props.sources.slice(0, PILL_FACES)}>
          {(source) => <SourceFace source={source} />}
        </For>
      </span>
      {props.total} {props.total === 1 ? 'source' : 'sources'}
    </button>
  );
}

/** One web page among the sources: its title, its site, and a way out. */
function WebSourceRow(props: { url: string; title?: string | null }) {
  const site = () => siteOf(props.url);
  return (
    <CardRow onClick={() => openExternalUrl(props.url)}>
      <Tile size={24} tone="frame">
        <Favicon url={props.url} class="size-3.5" />
      </Tile>
      <span class="flex min-w-0 flex-1 flex-col">
        <span class="truncate text-sm text-ink">{props.title || site()}</span>
        <span class="truncate text-xs text-ink-subtle">{site()}</span>
      </span>
      <OpenArrow />
    </CardRow>
  );
}

/**
 * One workspace item among the sources, loaded with the viewer's own
 * access: a viewer who cannot open it sees only what kind of item it is.
 */
function ItemSourceRow(props: { type: LoadableType; id: string }) {
  const data = useItemPreviewData(() => ({
    id: props.id,
    type: PREVIEW_TYPES[props.type],
  }));
  const accessible = () => {
    const item = data.item();
    return isAccessiblePreviewItem(item) ? item : undefined;
  };
  const kind = () => itemKind(props.type, accessible()?.fileType);
  return (
    <CardRow
      onClick={
        accessible()
          ? (event) => {
              const item = accessible();
              if (!item) return;
              data.onPreviewClick(
                item.type,
                item.id,
                item.fileType,
                item.subType?.type,
                event.shiftKey
              );
            }
          : undefined
      }
    >
      <Tile size={24}>
        <EntityIcon
          targetType={
            accessible() ? data.targetType() : fallbackIcon(props.type)
          }
          size="xs"
        />
      </Tile>
      <span class="flex min-w-0 flex-1 flex-col">
        <span
          class={cn(
            'truncate text-sm',
            accessible() ? 'text-ink' : 'text-ink-subtle'
          )}
        >
          {accessible() ? data.name() : `${kind()} you can't open`}
        </span>
        <span class="truncate text-xs text-ink-subtle">{kind()}</span>
      </span>
    </CardRow>
  );
}

/**
 * What an answer rests on, as a list: the searches the agent ran, then each
 * page and item it found. A long list holds a fixed height and says how
 * many are below.
 */
export function SourcesList(props: {
  queries: readonly string[];
  sources: readonly SourceRef[];
  total: number;
  onClose?: () => void;
  /** Rows for workspace items; the fixture gallery passes its own. */
  itemRow?: (source: Extract<SourceRef, { kind: 'item' }>) => JSX.Element;
}) {
  const subtitle = () =>
    [
      props.total > props.sources.length
        ? `${props.sources.length} of ${props.total}`
        : `${props.total} ${props.total === 1 ? 'source' : 'sources'}`,
      props.queries.length
        ? `Searched ${props.queries.map((query) => `“${query}”`).join(', ')}`
        : undefined,
    ]
      .filter(Boolean)
      .join(' · ');
  return (
    <Card
      width="standard"
      height={props.sources.length > SOURCE_ROWS ? 320 : 'auto'}
      data-agent-card="sources"
    >
      <section aria-label="Sources" class="flex min-h-0 flex-1 flex-col">
        <CardHeader
          center
          title="Sources"
          subtitle={subtitle()}
          trailing={
            <Show when={props.onClose}>
              {(close) => (
                <button
                  type="button"
                  class="flex size-6 flex-none items-center justify-center rounded-md text-ink-subtle hover:bg-hover hover:text-ink"
                  aria-label="Hide sources"
                  onClick={() => close()()}
                >
                  <CaretUp class="size-3.5" />
                </button>
              )}
            </Show>
          }
        />
        <CardBody tight>
          <For each={props.sources}>
            {(source) =>
              source.kind === 'web' ? (
                <WebSourceRow url={source.url} title={source.title} />
              ) : (
                (props.itemRow?.(source) ?? (
                  <ItemSourceRow type={source.itemType} id={source.itemId} />
                ))
              )
            }
          </For>
        </CardBody>
        <Show when={props.sources.length > SOURCE_ROWS}>
          <CardFooter small>
            <CardHiddenCount total={props.sources.length} noun="sources" />
          </CardFooter>
        </Show>
      </section>
    </Card>
  );
}

/**
 * What a run's searches found: a pill under the steps, which opens into the
 * list of sources and folds back.
 */
export function Sources(props: {
  queries: readonly string[];
  sources: readonly SourceRef[];
  total: number;
}) {
  const [open, setOpen] = createSignal(false);
  return (
    <Show
      when={open()}
      fallback={
        <SourcesPill
          sources={props.sources}
          total={props.total}
          onOpen={() => setOpen(true)}
        />
      }
    >
      <SourcesList
        queries={props.queries}
        sources={props.sources}
        total={props.total}
        onClose={() => setOpen(false)}
      />
    </Show>
  );
}
