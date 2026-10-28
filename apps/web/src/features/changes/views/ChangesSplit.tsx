/** Shared responsive split that retains host and diff owners through motion. */

import { FloatRegion } from '@components/app/mobile/float-regions/FloatRegion';
import { FloatRegions } from '@components/app/mobile/float-regions/float-region-state';
import { Resize } from '@core/component/Resize';
import type { ResizeZoneCtx } from '@core/component/Resize/types';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  type ParentProps,
  Show,
} from 'solid-js';
import { useChanges } from '../context/changes-controller';
import { createChangesNarrow } from '../primitives/create-changes-narrow';
import { createSplitPresence } from '../primitives/create-split-presence';
import { ChangesPane } from './ChangesPane';

const HOST_MIN_PX = 320;
const CHANGES_MIN_PX = 400;

export function ChangesSplit(props: ParentProps) {
  const { available, layout } = useChanges();
  const [root, setRoot] = createSignal<HTMLDivElement>();
  const narrow = createChangesNarrow(root);
  let zone: ResizeZoneCtx | undefined;
  let hostContent: HTMLDivElement | undefined;
  // A host that can never have changes keeps the session alone on screen,
  // whatever a stale URL asks for.
  // Split/full changes keep the same visibility and must not replay the slide.
  const changesVisible = createMemo(
    () => available() && layout.changesVisible()
  );
  const presence = createSplitPresence(changesVisible, () => hostContent);
  const hostVisible = createMemo<boolean>((previous) => {
    if (!available()) return true;
    // A narrow host opens as a takeover without changing the saved wide layout.
    if (changesVisible() && narrow()) return false;
    // A spotlight request during a slide waits for the slide to settle, so its
    // endpoint does not move underneath the running translation.
    if (presence.transitioning()) return previous ?? layout.hostVisible();
    if (changesVisible()) return layout.hostVisible();
    // Closing from full width must not shrink the pane before it slides out.
    return presence.present() ? (previous ?? true) : true;
  });
  // Reveal the retained host behind a full-width slide without changing the
  // Changes panel's solved geometry until the slide finishes, including reversals.
  const slideUnderlay = () =>
    presence.present() &&
    !hostVisible() &&
    (!changesVisible() || presence.transitioning());
  const hostShown = () => hostVisible() || slideUnderlay();

  return (
    <div
      ref={setRoot}
      data-changes-host
      class="size-full min-h-0 min-w-0 overflow-hidden"
    >
      <Show
        when={isTouchDevice()}
        fallback={
          <Resize.Zone
            direction="horizontal"
            gutter={1}
            class="overflow-hidden"
            resizable
            captureResizeCtx={(ctx) => {
              zone = ctx;
              createEffect(on(ctx.size, presence.finish, { defer: true }));
            }}
          >
            {/* Hiding retains resize intent and the host's editor/composer owner. */}
            <Resize.Panel
              id="changes-content"
              minSize={HOST_MIN_PX}
              index={0}
              persistent
              hidden={() => !hostVisible()}
            >
              <div
                ref={hostContent}
                data-changes-content
                data-slide-underlay={slideUnderlay() ? '' : undefined}
                hidden={!hostShown()}
                inert={!hostVisible() && changesVisible()}
                style={{
                  width: slideUnderlay() ? `${zone?.size() ?? 0}px` : undefined,
                }}
                class="flex h-full min-w-0 flex-col overflow-hidden"
              >
                {props.children}
              </div>
            </Resize.Panel>
            <Show when={presence.present()}>
              <Resize.Panel
                id="changes-pane"
                minSize={CHANGES_MIN_PX}
                index={1}
                target={layout.changesShare()}
                onSizeChangeEnd={(size) => {
                  const total = zone?.size() ?? 0;
                  if (total > 0) layout.setChangesShare((size / total) * 100);
                }}
              >
                <div ref={presence.ref} class="h-full min-w-0 overflow-hidden">
                  <ChangesPane fullWidth={narrow()} />
                </div>
              </Resize.Panel>
            </Show>
          </Resize.Zone>
        }
      >
        <div class="relative flex size-full min-w-0 flex-col overflow-hidden">
          <div
            class="flex size-full min-w-0 flex-col"
            classList={{ hidden: changesVisible() }}
            inert={changesVisible()}
          >
            {props.children}
          </div>
          <Show when={presence.present()}>
            <div
              ref={presence.ref}
              class="absolute inset-0 min-w-0 pt-(--mobile-content-inset-top)"
              style={{ 'padding-bottom': `${FloatRegions.hostHeight()}px` }}
            >
              <FloatRegion region="accessory" priority={1}>
                <span />
              </FloatRegion>
              <ChangesPane fullWidth />
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
