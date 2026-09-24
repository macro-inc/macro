import { SplitHeaderLeft } from '@components/app/split-layout/components/SplitHeader';
import { StaticSplitLabel } from '@components/app/split-layout/components/SplitLabel';
import { createGraphicsPeerLab } from '@macro-inc/graphics/loro';
import { createSignal, onCleanup, Show } from 'solid-js';
import { createPeerTestScene } from './core/test-scenes';
import { PeerLabView } from './views/peer-lab-view';

export default function LoroPlayground() {
  const [lab, setLab] = createSignal(
    createGraphicsPeerLab(createPeerTestScene())
  );
  return (
    <>
      <SplitHeaderLeft>
        <StaticSplitLabel label="Graphics multiplayer playground" />
      </SplitHeaderLeft>
      <Show keyed when={lab()}>
        {(current) => {
          onCleanup(() => current.dispose());
          return (
            <PeerLabView
              lab={current}
              onReset={() =>
                setLab(createGraphicsPeerLab(createPeerTestScene()))
              }
            />
          );
        }}
      </Show>
    </>
  );
}
