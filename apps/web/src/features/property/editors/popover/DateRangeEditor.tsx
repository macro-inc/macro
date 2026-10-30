import { TimeRangeEditor } from '@app/components/date-time-range/time-range-editor';
import { fireAndForget } from '@core/util/fireAndForget';
import { Show } from 'solid-js';
import { useProperty } from '../../core/context';
import type { DateRangeProperty, DateRangeValue } from '../../types';
import { isDateRangeProperty } from '../../utils/typeGuards';
import { EditorPopover } from './EditorPopover';

/** Time range editor popover; saves every complete change, or a clear. */
export function DateRangeEditor() {
  const ctx = useProperty();
  const property = () => {
    const current = ctx.property();
    return isDateRangeProperty(current) ? current : undefined;
  };

  return (
    <Show when={ctx.editorOpen() && property()}>
      {(range) => <DateRangeEditorBody property={range()} />}
    </Show>
  );
}

function DateRangeEditorBody(props: { property: DateRangeProperty }) {
  const ctx = useProperty();

  const commit = async (range: DateRangeValue | null) => {
    try {
      await ctx.onSave?.(props.property, {
        valueType: 'DATE_RANGE',
        value: range,
      });
    } catch {
      // mutation onError owns toast
    }
  };

  return (
    // The range fields open their date and time lists inside.
    <EditorPopover class="portal-scope w-max max-w-[calc(100vw-1rem)] overflow-visible">
      <TimeRangeEditor
        subject={props.property.displayName}
        range={props.property.value ?? undefined}
        onChange={(range) => {
          fireAndForget(commit(range), 'property-editor');
        }}
        onClear={() => ctx.closeEditor()}
      />
    </EditorPopover>
  );
}
