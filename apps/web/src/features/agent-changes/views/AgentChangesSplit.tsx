/**
 * The session and its Changes pane side by side, on a draggable divider.
 * Closing the pane hands the width back to the session; spotlighting it
 * takes the session's width away.
 */

import { FloatRegion } from '@components/app/mobile/float-regions/FloatRegion';
import { FloatRegions } from '@components/app/mobile/float-regions/float-region-state';
import { Resize } from '@core/component/Resize';
import type { ResizeZoneCtx } from '@core/component/Resize/types';
import { isMobile } from '@core/mobile/isMobile';
import { type ParentProps, Show } from 'solid-js';
import { useAgentChanges } from '../context/agent-changes-controller';
import { ChangesPane } from './ChangesPane';

const SESSION_MIN_PX = 320;
const CHANGES_MIN_PX = 400;

export function AgentChangesSplit(props: ParentProps) {
  const { available, layout } = useAgentChanges();
  let zone: ResizeZoneCtx | undefined;
  // A host that can never have changes keeps the session alone on screen,
  // whatever a stale URL asks for.
  const sessionVisible = () => !available() || layout.sessionVisible();
  const changesVisible = () => available() && layout.changesVisible();

  return (
    <Show
      when={isMobile()}
      fallback={
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
      }
    >
      <div class="relative flex size-full min-w-0 flex-col">
        <div
          class="flex size-full min-w-0 flex-col"
          classList={{ hidden: changesVisible() }}
          inert={changesVisible()}
        >
          {props.children}
        </div>
        <Show when={changesVisible()}>
          <FloatRegion region="accessory" priority={1}>
            <span />
          </FloatRegion>
          <div
            class="absolute inset-0 min-w-0 pt-(--mobile-content-inset-top)"
            style={{ 'padding-bottom': `${FloatRegions.hostHeight()}px` }}
          >
            <ChangesPane />
          </div>
        </Show>
      </div>
    </Show>
  );
}
