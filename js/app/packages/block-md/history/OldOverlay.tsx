import { useSplitPanel } from '@app/component/split-layout/layoutUtils';
import { Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { useHistory } from './HistoryContext';

export function OldOverlay() {
  const history = useHistory();
  const splitPanel = useSplitPanel();
  const oldOverlayMount = () => splitPanel?.layoutRefs.overlay;

  return (
    <Show when={history.isViewingHistory() && oldOverlayMount()}>
      <Portal mount={oldOverlayMount()!}>
        <div class="pointer-events-none absolute inset-0 overflow-hidden">
          <div class="absolute inset-0 bg-gradient-to-b from-ink/[0.028] via-transparent to-ink/[0.018]" />
          <div
            class="absolute inset-0 text-ink opacity-[0.035]"
            style={{
              'background-image':
                'radial-gradient(currentColor 0.45px, transparent 0.6px)',
              'background-size': '7px 7px',
            }}
          />

          <div class="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-ink/[0.045] via-ink/[0.014] to-transparent" />
          <div class="absolute -top-32 right-[12%] h-[38rem] w-28 rotate-12 rounded-full bg-gradient-to-b from-ink/[0.09] via-ink/[0.018] to-transparent blur-sm" />
          <div class="absolute top-8 right-[32%] h-96 w-9 rotate-12 rounded-full bg-gradient-to-b from-ink/[0.06] via-ink/[0.014] to-transparent blur-[1px]" />
          <div class="absolute bottom-[-20%] left-[10%] h-80 w-16 -rotate-12 rounded-full bg-gradient-to-t from-ink/[0.045] via-ink/[0.01] to-transparent blur-md" />

          <div class="absolute top-[18%] left-[-8%] h-px w-[70%] rotate-[-9deg] bg-gradient-to-r from-transparent via-ink/[0.08] to-transparent" />
          <div class="absolute top-[42%] right-[-12%] h-px w-[62%] rotate-[-9deg] bg-gradient-to-r from-transparent via-ink/[0.055] to-transparent" />
          <div class="absolute top-[58%] left-[18%] h-px w-[34%] rotate-[-9deg] bg-gradient-to-r from-transparent via-ink/[0.045] to-transparent" />

          <div class="absolute top-[17%] right-[18%] h-px w-28 rotate-[28deg] bg-gradient-to-r from-transparent via-ink/[0.16] to-transparent" />
          <div class="absolute top-[20%] right-[15%] h-px w-14 rotate-[-18deg] bg-gradient-to-r from-transparent via-ink/[0.12] to-transparent" />
          <div class="absolute top-[22%] right-[23%] h-px w-10 rotate-[62deg] bg-gradient-to-r from-transparent via-ink/[0.10] to-transparent" />
          <div class="absolute top-[15%] right-[25%] h-px w-8 rotate-[-54deg] bg-gradient-to-r from-transparent via-ink/[0.09] to-transparent" />
          <div class="absolute top-[24%] right-[12%] h-px w-18 rotate-[7deg] bg-gradient-to-r from-transparent via-ink/[0.08] to-transparent" />
          <div class="absolute top-[28%] right-[30%] h-px w-16 rotate-[41deg] bg-gradient-to-r from-transparent via-ink/[0.07] to-transparent" />

          <div class="absolute top-[36%] left-[38%] h-px w-32 rotate-[13deg] bg-gradient-to-r from-transparent via-ink/[0.13] to-transparent" />
          <div class="absolute top-[38%] left-[48%] h-px w-12 rotate-[-42deg] bg-gradient-to-r from-transparent via-ink/[0.10] to-transparent" />
          <div class="absolute top-[40%] left-[34%] h-px w-10 rotate-[68deg] bg-gradient-to-r from-transparent via-ink/[0.075] to-transparent" />
          <div class="absolute top-[33%] left-[54%] h-px w-7 rotate-[96deg] bg-gradient-to-r from-transparent via-ink/[0.07] to-transparent" />

          <div class="absolute bottom-[24%] left-[14%] h-px w-24 rotate-[-31deg] bg-gradient-to-r from-transparent via-ink/[0.12] to-transparent" />
          <div class="absolute bottom-[22%] left-[20%] h-px w-12 rotate-[18deg] bg-gradient-to-r from-transparent via-ink/[0.09] to-transparent" />
          <div class="absolute bottom-[18%] left-[11%] h-px w-14 rotate-[48deg] bg-gradient-to-r from-transparent via-ink/[0.08] to-transparent" />
          <div class="absolute bottom-[29%] left-[22%] h-px w-9 rotate-[-74deg] bg-gradient-to-r from-transparent via-ink/[0.07] to-transparent" />
          <div class="absolute bottom-[14%] right-[28%] h-px w-20 rotate-[-12deg] bg-gradient-to-r from-transparent via-ink/[0.085] to-transparent" />
          <div class="absolute bottom-[16%] right-[35%] h-px w-10 rotate-[39deg] bg-gradient-to-r from-transparent via-ink/[0.065] to-transparent" />

          <div class="absolute top-0 right-0 h-24 w-48 bg-gradient-to-bl from-ink/[0.08] via-ink/[0.018] to-transparent" />
          <div class="absolute top-3 right-4 h-px w-28 bg-gradient-to-r from-transparent via-ink/[0.16] to-transparent" />
        </div>
      </Portal>
    </Show>
  );
}
