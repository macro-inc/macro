import { Show } from 'solid-js';
import { FoldedAnsiText } from './FoldedAnsiText';
import { OutputSurface } from './OutputSurface';

export function FoldedTerminal(props: {
  output: string;
  exitCode?: number | null;
}) {
  return (
    <OutputSurface
      label="Terminal"
      text={props.output}
      trailing={
        <Show when={props.exitCode != null}>
          <span classList={{ 'text-failure': props.exitCode !== 0 }}>
            Exit {props.exitCode}
          </span>
        </Show>
      }
    >
      <FoldedAnsiText text={props.output} />
    </OutputSurface>
  );
}
