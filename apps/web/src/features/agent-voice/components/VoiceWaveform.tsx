import { For } from 'solid-js';

/** The bars are driven only by measured audio energy, never a fake activity loop. */
export function VoiceWaveform(props: {
  input: number;
  output: number;
  muted: boolean;
  connected: boolean;
}) {
  const bars = Array.from({ length: 37 }, (_, index) => index);
  const energy = () => Math.max(props.muted ? 0 : props.input, props.output);
  return (
    <div
      class="relative flex h-44 w-full items-center justify-center overflow-hidden"
      aria-hidden="true"
    >
      <div
        class="absolute size-36 rounded-full bg-accent/10 blur-3xl transition-opacity duration-300 motion-reduce:transition-none"
        style={{ opacity: props.connected ? 0.25 + energy() * 0.65 : 0.15 }}
      />
      <div class="relative flex h-28 items-center gap-[5px]">
        <For each={bars}>
          {(index) => {
            const shape = Math.pow(
              Math.max(0, 1 - Math.abs(index - 18) / 19),
              0.7
            );
            const variation = 0.65 + Math.sin(index * 2.3) * 0.2;
            return (
              <div
                class="w-[3px] rounded-full bg-accent transition-[height,opacity] duration-75 motion-reduce:transition-none sm:w-1"
                style={{
                  height: `${4 + shape * energy() * variation * 120}px`,
                  opacity: `${props.connected ? 0.35 + shape * 0.6 : 0.2}`,
                }}
              />
            );
          }}
        </For>
      </div>
    </div>
  );
}
