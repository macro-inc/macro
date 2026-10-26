import PlugsIcon from '@icon/system/regular/plugs.svg';
import CodexIcon from '@icon/wide-codex-ide.svg';
import CursorIcon from '@icon/wide-cursor-ide.svg';
import { Dynamic } from 'solid-js/web';
import { match } from 'ts-pattern';

/** Provider mark for a harness, with a generic connection icon for unknown slugs. */
export function HarnessIcon(props: { harness: string; class?: string }) {
  const icon = () =>
    match(props.harness)
      .with('cursor', () => CursorIcon)
      .with('codex-cloud', () => CodexIcon)
      .otherwise(() => PlugsIcon);

  return <Dynamic component={icon()} class={props.class} aria-hidden="true" />;
}
