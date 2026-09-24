import {
  CompanyKanbanCardSurface,
  CompanyKanbanColumn,
} from '@companies/components/CompanyKanbanPrimitives';
import { CrmStageIcon } from '@companies/crm/StageIcon';
import { createElementSize } from '@solid-primitives/resize-observer';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import {
  DocsDemoPointer,
  DocsGraphicFrame,
} from '../../../../marketing/src/app/components/featureGraphics/DocsMarkdownScene';
import {
  CRM_DEMO_COMPANIES,
  CRM_DEMO_DURATION,
  crmDemoFrame,
} from '../core/crm-demo';
import { homepagePeople } from '../core/homepage-demo-people';
import './homepage-crm.css';

const STAGES = ['Qualified', 'Proposal', 'Closed won'];
type Company = (typeof CRM_DEMO_COMPANIES)[number];
function DemoCard(props: { company: Company }) {
  return (
    <CompanyKanbanCardSurface
      icon={
        <span class="homepage-crm-company-mark">{props.company.initials}</span>
      }
      title={props.company.name}
      owner={
        <img
          class="ml-auto size-5 rounded-full"
          src={homepagePeople.valentina.photo}
          alt="Valentina"
        />
      }
      domain={<span class="truncate">{props.company.domain}</span>}
      updatedAt={<span class="ml-auto shrink-0">Today</span>}
    />
  );
}

export default function HomepageCrm() {
  const [time, setTime] = createSignal(0);
  const [paused, setPaused] = createSignal(false);
  const [visible, setVisible] = createSignal(false);
  const [reduced, setReduced] = createSignal(false);
  const [viewport, setViewport] = createSignal<HTMLDivElement>();
  const size = createElementSize(viewport);
  const frame = () => crmDemoFrame(time());
  const complete = createMemo(() => time() >= CRM_DEMO_DURATION);
  const scale = () =>
    (size.width ?? 864) / ((size.width ?? 864) < 600 ? 390 : 864);
  // On a phone the camera follows the card, keeping its destination visible.
  const camera = () =>
    (size.width ?? 864) < 600 ? Math.min(474, Math.max(0, frame().x - 170)) : 0;
  const stage = (company: Company) =>
    company.id === 'northwind'
      ? frame().northwindStage
      : company.id === 'lumen'
        ? frame().lumenStage
        : company.stage;
  const moving = () =>
    CRM_DEMO_COMPANIES.find((c) => c.id === frame().company)!;

  onMount(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => {
      setReduced(media.matches);
      if (media.matches) setTime(CRM_DEMO_DURATION);
    };
    sync();
    media.addEventListener('change', sync);
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries.some((e) => e.isIntersecting)),
      { threshold: 0.3 }
    );
    if (viewport()) observer.observe(viewport()!);
    onCleanup(() => {
      observer.disconnect();
      media.removeEventListener('change', sync);
    });
  });
  createEffect(() => {
    if (!visible() || paused() || reduced() || complete()) return;
    let previous = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const elapsed = Math.min(now - previous, 64);
      previous = now;
      raf = requestAnimationFrame(tick);
      if (!document.hidden)
        setTime((t) => Math.min(CRM_DEMO_DURATION, t + elapsed));
    };
    raf = requestAnimationFrame(tick);
    onCleanup(() => cancelAnimationFrame(raf));
  });

  return (
    <div class="homepage-crm workspace-demo">
      <DocsGraphicFrame>
        <div class="homepage-crm-header">
          <span>
            Customers <span class="text-ink-extra-muted">/ Pipeline</span>
          </span>
          <span class="text-xs text-ink-extra-muted">4 companies</span>
        </div>
        <div
          ref={setViewport}
          class="homepage-crm-viewport"
          role="img"
          aria-label="Claude moves Northwind from Qualified to Proposal, then Lumen from Proposal to Closed won."
        >
          <div
            class="homepage-crm-canvas"
            style={{
              transform: `scale(${scale()}) translateX(${-camera()}px)`,
            }}
            aria-hidden="true"
          >
            <div class="homepage-crm-columns">
              <For each={STAGES}>
                {(label, index) => (
                  <CompanyKanbanColumn
                    label={label}
                    icon={
                      <CrmStageIcon
                        optionId={`demo-${label}`}
                        index={index() === 2 ? 5 : index() + 1}
                        class="size-3.5"
                      />
                    }
                    highlighted={
                      frame().dragging &&
                      frame().target === index() &&
                      frame().travel > 0.55
                    }
                  >
                    <For
                      each={CRM_DEMO_COMPANIES.filter(
                        (c) => stage(c) === index()
                      ).sort(
                        (a, b) =>
                          Number(stage(a) !== a.stage) -
                          Number(stage(b) !== b.stage)
                      )}
                    >
                      {(company) => (
                        <div
                          data-crm-company={company.id}
                          data-crm-stage={label}
                          class="homepage-crm-card"
                          style={{
                            opacity:
                              frame().dragging && frame().company === company.id
                                ? 0.18
                                : 1,
                          }}
                        >
                          <DemoCard company={company} />
                        </div>
                      )}
                    </For>
                  </CompanyKanbanColumn>
                )}
              </For>
            </div>
            <Show when={frame().dragging}>
              <div
                class="homepage-crm-drag"
                style={{
                  transform: `translate(${frame().x - 90}px, ${frame().y - 28}px) rotate(-2deg) scale(1.035)`,
                }}
              >
                <DemoCard company={moving()} />
              </div>
            </Show>
            <div
              class="homepage-crm-cursor"
              style={{
                transform: `translate(${frame().x}px, ${frame().y}px)`,
                opacity: frame().opacity,
              }}
            >
              <DocsDemoPointer />
              <span>Claude</span>
            </div>
          </div>
        </div>
        <div class="homepage-crm-footer">
          <span class="homepage-crm-status" role="status">
            {frame().status}
          </span>
          <Show when={!reduced()}>
            <div class="flex gap-3 shrink-0">
              <Show when={!complete()}>
                <button
                  type="button"
                  onClick={() => setPaused((p) => !p)}
                  aria-label={
                    paused() ? 'Play CRM walkthrough' : 'Pause CRM walkthrough'
                  }
                >
                  {paused() ? 'Play' : 'Pause'}
                </button>
              </Show>
              <button
                type="button"
                onClick={() => {
                  setTime(0);
                  setPaused(false);
                }}
                aria-label="Replay CRM walkthrough"
              >
                Replay
              </button>
            </div>
          </Show>
        </div>
      </DocsGraphicFrame>
    </div>
  );
}
