import { FloatRegion } from '@components/app/mobile/float-regions/FloatRegion';
import { FloatRegions } from '@components/app/mobile/float-regions/float-region-state';
import { Resize } from '@core/component/Resize';
import { createElementSize } from '@solid-primitives/resize-observer';
import { createSignal, type ParentProps, Show } from 'solid-js';
import type { ConnectScreen } from '../context/screen-context';
import { useScreen } from '../context/screen-context';
import { ScreenPane } from './screen-pane';

export function ScreenSplit(props: ParentProps<{ connect: ConnectScreen }>) {
  const screen = useScreen();
  const [root, setRoot] = createSignal<HTMLDivElement>();
  const size = createElementSize(root);
  const visible = () => screen.available() && screen.open();
  const takeover = () => screen.host.mobile() || (size.width ?? 0) < 760;
  return (
    <div
      ref={setRoot}
      class="relative size-full min-h-0 min-w-0 overflow-hidden"
    >
      <Resize.Zone
        direction="horizontal"
        gutter={1}
        resizable
        class="overflow-hidden"
      >
        <Resize.Panel
          id="screen-content"
          index={0}
          minSize={320}
          persistent
          hidden={() => visible() && takeover()}
        >
          <div class="flex size-full min-h-0 min-w-0 flex-col">
            {props.children}
          </div>
        </Resize.Panel>
        <Show when={visible() && !takeover()}>
          <Resize.Panel id="screen-pane" index={1} minSize={360} target={50}>
            <ScreenPane connect={props.connect} />
          </Resize.Panel>
        </Show>
      </Resize.Zone>
      <Show when={visible() && takeover()}>
        <div
          class="absolute inset-0 z-1 pt-(--mobile-content-inset-top)"
          style={{
            'padding-bottom': screen.host.mobile()
              ? `${FloatRegions.hostHeight()}px`
              : undefined,
          }}
        >
          <Show when={screen.host.mobile()}>
            <FloatRegion region="accessory" priority={2}>
              <span />
            </FloatRegion>
          </Show>
          <ScreenPane connect={props.connect} />
        </div>
      </Show>
    </div>
  );
}
