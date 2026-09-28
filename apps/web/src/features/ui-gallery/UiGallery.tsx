import { useSearchParams } from '@solidjs/router';
import { Scroll, ToggleSwitch } from '@ui';
import { createMemo, createSignal, Show } from 'solid-js';
import './gallery.css';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@components/app/split-layout/components/SplitHeader';
import { StaticSplitLabel } from '@components/app/split-layout/components/SplitLabel';
import { CoveragePage } from './components/CoveragePage';
import { DocPage } from './components/DocPage';
import { COVERAGE_SLUG, GallerySidebar } from './components/GallerySidebar';
import { DOC_ENTRIES, findEntry, groupEntries } from './registry';

/** Query param carrying the selected page, so a component is linkable. The
 *  split layout drops params from `component/<id>` URLs, so selection lives in
 *  the query string the same way the CRM's saved view does. */
const PAGE_PARAM = 'ui';
const DEFAULT_ENTRY = groupEntries(DOC_ENTRIES)[0]?.entries[0];

/**
 * Browsable documentation for the `@ui` library: a stable sidebar and page
 * chrome around live component previews.
 *
 * Pages are `*.docs.tsx` files co-located with the components they document
 * (see `registry.ts`), and each demo's code is read back out of its own source
 * so the snippet can never drift from the preview above it.
 */
export default function UiGallery() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [showCode, setShowCode] = createSignal(false);

  const selected = () => {
    const param = searchParams[PAGE_PARAM];
    const slug = Array.isArray(param) ? param[0] : param;
    return slug ?? DEFAULT_ENTRY?.slug ?? COVERAGE_SLUG;
  };

  const select = (slug: string) =>
    setSearchParams({ [PAGE_PARAM]: slug }, { scroll: false });

  const entry = createMemo(() => findEntry(selected()));

  return (
    <>
      <SplitHeaderLeft>
        <StaticSplitLabel label="UI Components" />
      </SplitHeaderLeft>
      <SplitHeaderRight>
        <ToggleSwitch
          checked={showCode()}
          onChange={setShowCode}
          label="Show code"
          labelClass="text-xs text-ink-muted"
        />
      </SplitHeaderRight>

      <div class="ui-gallery size-full flex min-h-0 border-t border-edge-muted">
        <GallerySidebar
          entries={DOC_ENTRIES}
          selected={selected()}
          onSelect={select}
        />

        <div class="flex-1 min-w-0 flex flex-col">
          <Scroll class="flex-1 min-h-0 p-4 select-children">
            <Show when={entry()} fallback={<CoveragePage onSelect={select} />}>
              {(found) => <DocPage entry={found()} showCode={showCode()} />}
            </Show>
          </Scroll>
        </div>
      </div>
    </>
  );
}
