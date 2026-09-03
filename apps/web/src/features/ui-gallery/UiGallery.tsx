import { useSearchParams } from '@solidjs/router';
import { DEFAULT_THEMES } from '@theme/themes';
import type { ThemeV3 } from '@theme/types/themeTypes';
import { Scroll } from '@ui';
import { createMemo, createSignal, Show } from 'solid-js';
import './gallery.css';
import { CoveragePage } from './components/CoveragePage';
import { DocPage } from './components/DocPage';
import type { PreviewSettings } from './components/DemoPreview';
import { COVERAGE_SLUG, GallerySidebar } from './components/GallerySidebar';
import { PreviewToolbar } from './components/PreviewToolbar';
import { DOC_ENTRIES, findEntry } from './registry';

/** Query param carrying the selected page, so a component is linkable. The
 *  split layout drops params from `component/<id>` URLs, so selection lives in
 *  the query string the same way the CRM's saved view does. */
const PAGE_PARAM = 'ui';

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
  const [theme, setTheme] = createSignal<ThemeV3 | null>(null);
  const [depth, setDepth] = createSignal<0 | 1 | 2 | 3 | 4>(1);

  const selected = () => {
    const param = searchParams[PAGE_PARAM];
    const slug = Array.isArray(param) ? param[0] : param;
    return slug ?? DOC_ENTRIES[0]?.slug ?? COVERAGE_SLUG;
  };

  const select = (slug: string) =>
    setSearchParams({ [PAGE_PARAM]: slug }, { scroll: false });

  const entry = createMemo(() => findEntry(selected()));
  const settings = (): PreviewSettings => ({ theme: theme(), depth: depth() });

  return (
    <div class="ui-gallery size-full flex min-h-0 bg-page">
      <GallerySidebar
        entries={DOC_ENTRIES}
        selected={selected()}
        onSelect={select}
      />

      <div class="flex-1 min-w-0 flex flex-col">
        <div class="flex items-center justify-end gap-4 px-8 h-12 shrink-0 border-b border-edge-muted">
          <PreviewToolbar
            themes={DEFAULT_THEMES}
            settings={settings()}
            onThemeChange={setTheme}
            onDepthChange={setDepth}
          />
        </div>

        <Scroll class="flex-1 min-h-0">
          <div class="px-8 py-8">
            <Show when={entry()} fallback={<CoveragePage onSelect={select} />}>
              {(found) => <DocPage entry={found()} settings={settings()} />}
            </Show>
          </div>
        </Scroll>
      </div>
    </div>
  );
}
