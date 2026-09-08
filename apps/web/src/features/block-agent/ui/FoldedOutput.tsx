import { OutputSurface } from './OutputSurface';

/** Raw output stays available without dominating the conversation. */
export function FoldedOutput(props: { text: string; label?: string }) {
  return (
    <OutputSurface label={props.label ?? 'Output'} text={props.text}>
      {props.text}
    </OutputSurface>
  );
}
