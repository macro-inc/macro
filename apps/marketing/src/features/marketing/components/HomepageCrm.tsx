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
import { DocsGraphicFrame } from '../../../app/components/featureGraphics/DocsMarkdownScene';
import {
  CRM_DEMO_COMPANIES,
  CRM_DEMO_DURATION,
  crmDemoFrame,
} from '../core/crm-demo';
import { homepagePeople } from '../core/homepage-demo-people';
import { observeDemoTakeover } from '../primitives/observeDemoTakeover';
import {
  CompanyKanbanCardSurface,
  CompanyKanbanColumn,
} from './DemoCompanyKanban';
import { DemoCursor } from './DemoCursor';
import { CrmStageIcon } from './DemoStageIcon';
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
    const releaseTakeover = viewport()
      ? observeDemoTakeover(viewport()!, () => setPaused(true))
      : undefined;
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => {
      setReduced(media.matches);
      if (media.matches) setTime(CRM_DEMO_DURATION);
    };
    sync();
    media.addEventListener('change', sync);
    const observer = new IntersectionObserver(
      (entries) =>
        setVisible(
          entries.some(
            (entry) => entry.isIntersecting && entry.intersectionRatio >= 0.3
          )
        ),
      { threshold: 0.3 }
    );
    if (viewport()) observer.observe(viewport()!);
    onCleanup(() => {
      releaseTakeover?.();
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
          aria-label="Claude moves Keystone Mechanical from Qualified to Proposal, then Bookend Retail from Proposal to Closed won."
        >
          <div
            class="homepage-crm-canvas"
            style={{
              transform: `translate3d(${-camera() * scale()}px, 0, 0) scale(${scale()})`,
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
                            visibility:
                              frame().dragging && frame().company === company.id
                                ? 'hidden'
                                : 'visible',
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
          </div>
          {/* Keep moving objects outside the panning board so each has one
              viewport-space transform rather than nested moving layers. */}
          <Show when={frame().dragging}>
            <div
              class="homepage-crm-drag"
              aria-hidden="true"
              style={{
                transform: `translate3d(${(frame().x - 90 - camera()) * scale()}px, ${(frame().y - 28) * scale()}px, 0) scale(${scale() * 1.035})`,
              }}
            >
              <DemoCard company={moving()} />
            </div>
          </Show>
          <DemoCursor
            class="homepage-crm-cursor"
            style={{
              transform: `translate3d(${(frame().x - camera()) * scale()}px, ${frame().y * scale()}px, 0) scale(${scale()})`,
              opacity: frame().opacity,
            }}
          />
        </div>
      </DocsGraphicFrame>
    </div>
  );
}
