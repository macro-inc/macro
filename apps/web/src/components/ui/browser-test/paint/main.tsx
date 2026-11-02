import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { AgentSessionStatusIndicator } from '@app/features/agents-view/components/AgentSessionRow';
import { TextShimmer } from '@app/features/block-agent/ui/TextShimmer';
import { WorkingLine } from '@app/features/block-agent/ui/WorkingLine';
import { macroDarkTheme } from '@app/features/theme/themes/macro-dark';
import { macroLightTheme } from '@app/features/theme/themes/macro-light';
import { CircleSpinner } from '@core/component/CircleSpinner';
import { LoadingSpinner } from '@core/component/LoadingSpinner';
import LegacyBrandLoader from '@icon/macro-brand-loader.svg';
import { Button } from '@ui/components/Button';
import { Dialog } from '@ui/components/Dialog';
import { Surface } from '@ui/components/Surface';
import { createSignal, For, Show } from 'solid-js';
import { render } from 'solid-js/web';
import '../../../../index.css';

const params = new URLSearchParams(location.search);
const kind = params.get('kind') ?? 'surfaces';
const count = Number(params.get('count') ?? 40);
document.documentElement.dataset.themeLight = String(
  params.get('theme') === 'light'
);
const theme =
  params.get('theme') === 'light' ? macroLightTheme : macroDarkTheme;
for (const [token, value] of Object.entries(theme.colorTokens)) {
  document.documentElement.style.setProperty(`--color-${token}`, value);
}
document.documentElement.dataset.touchDevice = String(
  params.get('touch') === 'true'
);

function Fixture() {
  const [open, setOpen] = createSignal(false);
  return (
    <main data-scroll class="h-screen overflow-y-auto bg-page p-8 text-ink">
      <header class="mb-6 flex items-center gap-4">
        <h1 class="text-lg">Runtime paint fixture</h1>
        <Button size="sm" onClick={() => setOpen(true)}>
          Open dialog
        </Button>
      </header>
      <Show when={params.has('offscreen')}>
        <div style={{ height: '2000px' }} />
      </Show>
      <section class="grid grid-cols-4 gap-4" data-samples>
        <For each={Array.from({ length: count })}>
          {(_, index) => (
            <>
              <Show when={kind === 'surfaces'}>
                <Surface
                  hideBorder
                  class="h-24 rounded-xl glass bg-surface p-3"
                >
                  Glass {index()}
                </Surface>
                <div class="h-24 rounded-xl menu-surface p-3">
                  Menu {index()}
                </div>
                <Button size="md" variant="secondary">
                  Elevated {index()}
                </Button>
              </Show>
              <Show when={kind === 'shimmer'}>
                <TextShimmer text="Working on the document" active />
              </Show>
              <Show when={kind === 'loader'}>
                <LoadingSpinner class="size-24 p-4" />
              </Show>
              <Show when={kind === 'legacy-loader'}>
                <LegacyBrandLoader class="size-24" />
              </Show>
              <Show when={kind === 'working'}>
                <WorkingLine />
              </Show>
              <Show when={kind === 'skeleton'}>
                <ListSkeleton.Root label="Loading">
                  <ListSkeleton.Row>
                    <ListSkeleton.Bar class="w-32" />
                  </ListSkeleton.Row>
                </ListSkeleton.Root>
              </Show>
              <Show when={kind === 'agents'}>
                <div class="flex h-8 items-center gap-2">
                  <AgentSessionStatusIndicator state="working" />
                  <CircleSpinner />
                  Agent working
                </div>
              </Show>
            </>
          )}
        </For>
      </section>
      <Dialog open={open()} onOpenChange={setOpen} position="center">
        <div class="p-8">
          <h2 class="mb-4 text-lg">Dialog surface</h2>
          <WorkingLine />
          <Button class="mt-6" onClick={() => setOpen(false)}>
            Close dialog
          </Button>
        </div>
      </Dialog>
      <footer style={{ height: '1400px' }} />
    </main>
  );
}
render(() => <Fixture />, document.getElementById('root')!);
