import { isMobile } from '@core/mobile/isMobile';
import { Show } from 'solid-js';
import { useCompose } from './ComposeContext';

export function ComposeSubject(props: {
  inputRef?: (el: HTMLElement) => void;
}) {
  const ctx = useCompose();

  return (
    <div class="w-full flex items-center gap-2 border-b border-edge-muted focus-within:border-accent py-2">
      <div class="text-sm w-14 shrink-0 text-ink-placeholder">Subject</div>
      <div class="flex-1">
        <input
          ref={props.inputRef}
          type="text"
          value={ctx.subject()}
          placeholder={isMobile() ? '' : 'Subject'}
          class="w-full resize-none text-sm placeholder:text-ink-placeholder p-1"
          onInput={(e) => ctx.setSubject(e.currentTarget.value)}
          disabled={ctx.disabled()}
        />
      </div>
      <Show when={ctx.validationError('no_subject')}>
        {(err) => (
          <div class="text-failure-ink text-sm mt-1">{err().message}</div>
        )}
      </Show>
    </div>
  );
}
