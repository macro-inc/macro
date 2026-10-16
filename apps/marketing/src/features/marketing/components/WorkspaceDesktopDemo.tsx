import {
  createSignal,
  type JSX,
  lazy,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import type { DummyData, WorkspaceView } from '../core/dummy-workspace';
import { DeferredDemo } from './DeferredDemo';
import './email/email-desktop-demo.css';

const loadWorkspace = () => import('./workspace/DummyWorkspace');
const Workspace = lazy(loadWorkspace);

/** Shared desktop frame around a local, interactive sample workspace. */
export function WorkspaceDesktopDemo(props: {
  view: WorkspaceView;
  label: string;
  caption?: string;
  heroFrame?: boolean;
  /** Keep a desktop canvas intact inside a smaller marketing frame. */
  desktopWidth?: number;
  initialDocument?: string;
  /** Optional page-owned sample content; other demos keep their fixtures. */
  initialData?: Partial<DummyData>;
  initialChannelThread?: string;
  /** Open this sample agent conversation instead of a new one. */
  initialAgent?: string;
  agentShowcase?: boolean;
  tasksShowcase?: boolean;
  chatSplits?: boolean;
  children?: JSX.Element;
}) {
  let content!: HTMLDivElement;
  const [scale, setScale] = createSignal(1);
  onMount(() => {
    if (!props.desktopWidth) return;
    const desktop = window.matchMedia('(min-width: 700px)');
    const measure = () =>
      setScale(
        desktop.matches ? content.clientWidth / (props.desktopWidth ?? 1000) : 1
      );
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    desktop.addEventListener('change', measure);
    measure();
    onCleanup(() => {
      observer.disconnect();
      desktop.removeEventListener('change', measure);
    });
  });
  return (
    <section
      class="email-desktop-demo"
      aria-label={props.label}
      data-hero-frame={props.heroFrame ? 'true' : undefined}
      data-desktop-canvas={!!props.desktopWidth}
      data-agent-showcase={props.agentShowcase ? 'true' : undefined}
      style={{
        '--workspace-scale': scale(),
        '--workspace-width': `${props.desktopWidth ?? 1000}px`,
      }}
    >
      <div class="email-desktop-wallpaper">
        <div class="email-desktop-window">
          <div class="email-desktop-titlebar">
            <div class="email-desktop-traffic-lights" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <span>Macro</span>
            <a
              href={
                props.agentShowcase
                  ? '/demo?scene=agents'
                  : props.tasksShowcase
                    ? '/demo?scene=tasks'
                    : '/demo'
              }
              target="_blank"
              rel="noreferrer"
              aria-label="Open the sample workspace in a new tab"
            >
              ↗
            </a>
          </div>
          <div ref={content} class="email-desktop-content">
            <div class="email-desktop-canvas">
              <Show
                when={props.children}
                fallback={
                  <DeferredDemo
                    preload={loadWorkspace}
                    fallback={
                      <div class="email-desktop-loading" role="status">
                        Opening your sample workspace…
                      </div>
                    }
                  >
                    <Workspace
                      initialView={props.view}
                      initialData={props.initialData}
                      initialChannelThread={props.initialChannelThread}
                      initialDocument={props.initialDocument}
                      initialAgent={props.initialAgent}
                      agentShowcase={props.agentShowcase}
                      tasksShowcase={props.tasksShowcase}
                      chatSplits={props.chatSplits}
                      embedded
                    />
                  </DeferredDemo>
                }
              >
                {props.children}
              </Show>
            </div>
          </div>
        </div>
      </div>
      <Show when={props.caption}>
        <p class="email-desktop-caption">{props.caption}</p>
      </Show>
    </section>
  );
}
