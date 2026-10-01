import { type JSX, lazy, Show } from 'solid-js';
import type { WorkspaceView } from '../core/dummy-workspace';
import { DeferredDemo } from './DeferredDemo';
import './email/email-desktop-demo.css';

const loadWorkspace = () => import('./workspace/DummyWorkspace');
const Workspace = lazy(loadWorkspace);

/** Shared desktop frame around a local, interactive sample workspace. */
export function WorkspaceDesktopDemo(props: {
  view: WorkspaceView;
  label: string;
  caption: string;
  initialDocument?: string;
  children?: JSX.Element;
}) {
  return (
    <section class="email-desktop-demo" aria-label={props.label}>
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
              href="/demo"
              target="_blank"
              rel="noreferrer"
              aria-label="Open the sample workspace in a new tab"
            >
              ↗
            </a>
          </div>
          <div class="email-desktop-content">
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
                    initialDocument={props.initialDocument}
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
      <p class="email-desktop-caption">{props.caption}</p>
    </section>
  );
}
