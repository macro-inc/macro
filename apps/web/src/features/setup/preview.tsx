/** Public journey: preferences are saved locally; account setup lives in /app. */
import '../../index.css';
import {
  applyTheme,
  resolveActiveThemeId,
  systemThemeEffect,
} from '@theme/utils/themeUtils';
import {
  createEffect,
  createSignal,
  For,
  Match,
  onCleanup,
  Switch,
} from 'solid-js';
import { render } from 'solid-js/web';
import { HomepageFounderLetter } from '../marketing/components/HomepageFounderLetter';
import { HomepageSections } from '../marketing/components/HomepageSections';
import { HomepageUnification } from '../marketing/components/HomepageUnification';
import { OnboardingShell } from './components/OnboardingShell';
import { StoryStage } from './components/StoryStage';
import { ToolTile } from './components/ToolTile';
import { ViewGuideCard } from './components/ViewGuideCard';
import { CONSTELLATION_TOOLS } from './components/WelcomeSteps';
import { readJourney, saveJourney } from './core/journeyProgress';
import { VIEW_GUIDES } from './core/viewGuides';
import { CustomizeStep } from './flow/CustomizeStep';
import { ContinueButton } from './flow/shared';
import { PublicTeamStep } from './views/PublicTeamStep';

function Preview() {
  systemThemeEffect();
  createEffect(() => applyTheme(resolveActiveThemeId()));
  const saved = readJourney(localStorage);
  const isHomepage = window.location.pathname === '/';
  const [step, updateStep] = createSignal(
    isHomepage ? 0 : saved.step === 5 ? 4 : saved.step
  );
  const setStep = (value: number | ((previous: number) => number)) => {
    const next = typeof value === 'function' ? value(step()) : value;
    saveJourney(localStorage, { step: next });
    updateStep(next);
  };
  const [motionSpeed, setMotionSpeed] = createSignal(1);
  const desktopMedia = window.matchMedia('(min-width: 640px)');
  const [desktopGrid, setDesktopGrid] = createSignal(desktopMedia.matches);
  const updateGrid = () => setDesktopGrid(desktopMedia.matches);
  desktopMedia.addEventListener('change', updateGrid);
  onCleanup(() => desktopMedia.removeEventListener('change', updateGrid));
  const [search, updateSearch] = createSignal(saved.search);
  const setSearch = (value: string) => {
    saveJourney(localStorage, { search: value });
    updateSearch(value);
  };
  const [connected, updateConnected] = createSignal(saved.tools);
  const setConnected = (update: (value: string[]) => string[]) => {
    const tools = update(connected());
    saveJourney(localStorage, { tools });
    updateConnected(tools);
  };
  const [dismissed, setDismissed] = createSignal(false);
  const next = () => setStep((value) => Math.min(value + 1, 7));
  return (
    <>
      <OnboardingShell
        wide
        below={
          isHomepage && step() === 0 ? (
            <>
              <HomepageUnification />
              <HomepageFounderLetter />
              <HomepageSections />
            </>
          ) : undefined
        }
      >
        <Switch>
          <Match when={step() < 4}>
            <StoryStage
              step={
                (['welcome', 'vision', 'tools', 'security'] as const)[step()]
              }
              onNext={next}
              durationMs={1400 / motionSpeed()}
            >
              <div class="flex flex-col gap-6">
                <input
                  aria-label="Search tools"
                  placeholder="Search your tools…"
                  class="rounded-full border border-edge bg-input px-4 py-3 text-sm"
                  value={search()}
                  onInput={(event) => setSearch(event.currentTarget.value)}
                />
                <div class="grid grid-cols-3 gap-x-2 gap-y-5 sm:grid-cols-4">
                  <For
                    each={[...CONSTELLATION_TOOLS]
                      .sort((a, b) => {
                        const order = desktopGrid()
                          ? [
                              'PostHog',
                              'Calendly',
                              'Linear',
                              'Figma',
                              'Slack',
                              'Notion',
                              'Google',
                              'Superhuman',
                              'Zoom',
                              'HubSpot',
                              'GitHub',
                              'Google Meet',
                            ]
                          : [
                              'PostHog',
                              'Linear',
                              'Figma',
                              'Calendly',
                              'Google',
                              'Superhuman',
                              'Slack',
                              'Notion',
                              'Google Meet',
                              'Zoom',
                              'HubSpot',
                              'GitHub',
                            ];
                        return order.indexOf(a.name) - order.indexOf(b.name);
                      })
                      .filter((tool) =>
                        tool.name.toLowerCase().includes(search().toLowerCase())
                      )}
                  >
                    {(tool) => (
                      <ToolTile
                        name={tool.name}
                        icon={<tool.icon />}
                        connected={connected().includes(tool.name)}
                        onConnect={() =>
                          setConnected((value) => [...value, tool.name])
                        }
                        onDisconnect={() =>
                          setConnected((value) =>
                            value.filter((name) => name !== tool.name)
                          )
                        }
                      />
                    )}
                  </For>
                </div>
                <ContinueButton label="Can I trust it?" onClick={next} />
              </div>
            </StoryStage>
          </Match>
          <Match when={step() === 4}>
            <PublicTeamStep onContinue={() => setStep(6)} />
          </Match>
          <Match when={step() === 6}>
            <div class="flex flex-col gap-8">
              <h1 class="text-4xl tracking-tight">
                Make room for your best work.
              </h1>
              <CustomizeStep onContinue={next} />
            </div>
          </Match>
          <Match when={step() === 7}>
            <div class="flex flex-col gap-8">
              <h1 class="text-3xl">Keep finding your flow.</h1>
              <ViewGuideCard
                guide={VIEW_GUIDES.tasks}
                connected={false}
                dismissed={dismissed()}
                onDismiss={() => setDismissed(true)}
                onConnect={() => setStep(2)}
              />
              <ContinueButton
                label="Create my workspace"
                onClick={() => {
                  window.location.href = '/app/login';
                }}
              />
            </div>
          </Match>
        </Switch>
      </OnboardingShell>
      {import.meta.env.DEV && (
        <details class="fixed bottom-3 right-5 z-modal rounded-2xl border border-edge bg-surface p-2 text-[10px] text-ink-muted">
          <summary>Preview controls</summary>
          <nav aria-label="Preview screens" class="flex flex-wrap gap-1 py-2">
            <For
              each={[
                'Welcome',
                'Why',
                'Tools',
                'Security',
                'Team',
                'Team',
                'Appearance',
                'Guidance',
              ]}
            >
              {(label, index) => (
                <button
                  type="button"
                  class="rounded-full px-2 py-1"
                  aria-current={step() === index() ? 'step' : undefined}
                  hidden={index() === 5}
                  onClick={() => setStep(index())}
                >
                  {label}
                </button>
              )}
            </For>
          </nav>
          <label>
            Motion speed{' '}
            <select
              aria-label="Motion speed"
              class="bg-surface"
              value={motionSpeed()}
              onChange={(event) =>
                setMotionSpeed(Number(event.currentTarget.value))
              }
            >
              <option value="1">1× · 1.4s</option>
              <option value="0.25">¼× · 5.6s</option>
              <option value="0.1">⅒× · 14s</option>
            </select>
          </label>
        </details>
      )}
    </>
  );
}

const root = document.getElementById('root');
if (root) render(() => <Preview />, root);
