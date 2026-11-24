import { cn } from '@ui';
import type { ParentProps } from 'solid-js';
import { CalendarComposerContext } from '../../../context/calendar-composer-context';
import type { CalendarComposerModel } from '../../../primitives/create-calendar-composer';
import './composer-surface.css';

export function ComposerRoot(
  props: ParentProps<{ model: CalendarComposerModel; class?: string }>
) {
  return (
    <CalendarComposerContext.Provider value={props.model}>
      <form
        id={props.model.ids.form}
        class={cn(
          'calendar-composer flex min-h-0 flex-col text-sm text-ink',
          props.class
        )}
        style={{ '--color-ink-placeholder': 'var(--color-ink-subtle)' }}
        onSubmit={(event) => {
          event.preventDefault();
          props.model.submit();
        }}
      >
        {props.children}
      </form>
    </CalendarComposerContext.Provider>
  );
}
