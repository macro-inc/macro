import { match } from 'ts-pattern';

/**
 * Renames an answer in its title's exact place: same font, box and
 * baseline as the inline chip or the block header it replaces.
 */
export function AnswerTitleField(props: {
  placement: 'inline' | 'header';
  value: string;
  onInput: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  return (
    <input
      ref={(input) =>
        queueMicrotask(() => {
          input.focus();
          input.select();
        })
      }
      aria-label="Answer title"
      class={match(props.placement)
        .with(
          'inline',
          () =>
            'mx-0.5 min-w-0 rounded-md border border-edge bg-input px-1.5 py-0.5 align-baseline text-sm font-medium text-ink outline-none focus:border-ink/30'
        )
        .with(
          'header',
          () =>
            '-mx-[7px] h-5 min-w-0 flex-1 rounded border border-edge bg-input px-1.5 py-0 text-sm leading-5 font-medium text-ink outline-none focus:border-ink/30'
        )
        .exhaustive()}
      value={props.value}
      maxLength={100}
      on:input={(event) => props.onInput(event.currentTarget.value)}
      onBlur={() => props.onCommit()}
      onKeyDown={(event) => {
        if (event.isComposing || event.keyCode === 229) return;
        if (event.key === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          props.onCommit();
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          props.onCancel();
        }
      }}
    />
  );
}
