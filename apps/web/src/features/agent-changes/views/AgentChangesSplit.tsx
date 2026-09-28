/**
 * The session and its Changes pane side by side, on a draggable divider.
 * Closing the pane hands the width back to the session; spotlighting it
 * takes the session's width away.
 *
 * A phone has no room for two panes: there the open pane takes over the
 * whole session frame instead, and its header's back button is the way
 * out. The session stays mounted underneath so its transcript position
 * and draft survive the review.
 */

import { Resize } from '@core/component/Resize';
import type { ResizeZoneCtx } from '@core/component/Resize/types';
import { isMobile } from '@core/mobile/isMobile';
import { type ParentProps, Show } from 'solid-js';
import { useAgentChanges } from '../context/agent-changes-controller';
import { ChangesPane } from './ChangesPane';

const SESSION_MIN_PX = 320;
const CHANGES_MIN_PX = 400;

function TakeoverLayout(props: ParentProps<{ changesVisible: boolean }>) {
  return (
    <div class="relative flex h-full min-w-0 flex-col overflow-hidden">
      <div
        class="flex h-full min-w-0 flex-col overflow-hidden"
        // The covered session must not take focus or be read out.
        inert={props.changesVisible}
        aria-hidden={props.changesVisible || undefined}
      >
        {props.children}
      </div>
      <Show when={props.changesVisible}>
        {/* Above the split header's floating islands: the pane brings its
            own header, so the session's back button and title would only
            compete with it. The safe-area padding keeps that header under
            the status bar. */}
        <div class="absolute inset-0 z-split-panel-chrome flex flex-col bg-panel pt-(--safe-top)">
          <ChangesPane takeover />
        </div>
      </Show>
    </div>
  );
}

export function AgentChangesSplit(props: ParentProps) {
  const { available, layout } = useAgentChanges();
  let zone: ResizeZoneCtx | undefined;
  // A host that can never have changes keeps the session alone on screen,
  // whatever a stale URL or persisted layout asks for.
  const sessionVisible = () => !available() || layout.sessionVisible();
  const changesVisible = () => available() && layout.changesVisible();

  return (
    <Show
      when={!isMobile()}
      fallback={
        <TakeoverLayout changesVisible={changesVisible()}>
          {props.children}
        </TakeoverLayout>
      }
    >
      <Resize.Zone
        direction="horizontal"
        gutter={1}
        resizable
        captureResizeCtx={(ctx) => {
          zone = ctx;
        }}
      >
        {/* Panels mount and unmount with the layout: an unregistered panel
            would still paint its content at the zone's left edge. */}
        <Show when={sessionVisible()}>
          <Resize.Panel id="agent-session" minSize={SESSION_MIN_PX} index={0}>
            <div class="flex h-full min-w-0 flex-col overflow-hidden">
              {props.children}
            </div>
          </Resize.Panel>
        </Show>
        <Show when={changesVisible()}>
          <Resize.Panel
            id="agent-changes"
            minSize={CHANGES_MIN_PX}
            index={1}
            target={layout.changesShare()}
            onSizeChangeEnd={(size) => {
              const total = zone?.size() ?? 0;
              if (total > 0) layout.setChangesShare((size / total) * 100);
            }}
          >
            <div class="h-full min-w-0 overflow-hidden">
              <ChangesPane />
            </div>
          </Resize.Panel>
        </Show>
      </Resize.Zone>
    </Show>
  );
}
