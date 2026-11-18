import type { JSX } from 'solid-js';
import { ComposerCancel } from '../actions/ComposerCancel';
import { ComposerSubmit } from '../actions/ComposerSubmit';
import { ComposerScope } from '../scope/ComposerScope';

export function DesktopComposerFooter(props: {
  leading?: JSX.Element;
  onCancel: () => void;
}) {
  return (
    <>
      <div class="shrink-0 px-4 pb-2">
        <ComposerScope />
      </div>
      <div class="flex shrink-0 items-center gap-2 border-t border-divider pt-2.5 pr-3 pb-3.5 pl-2">
        {props.leading}
        <div class="flex-1" />
        <ComposerCancel onCancel={props.onCancel} />
        <ComposerSubmit />
      </div>
    </>
  );
}
