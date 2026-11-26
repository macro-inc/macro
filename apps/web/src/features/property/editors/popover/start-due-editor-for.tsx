import {
  type Accessor,
  type Component,
  type ComponentProps,
  Show,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { DateProperty } from '../../types';
import type { DateField } from '../../utils/start-due';
import { PopoverEditor } from './PopoverEditor';
import { StartDueEditor, type StartDueEditorProps } from './StartDueEditor';

/**
 * The editor for a Start Date or Due Date pill or cell: the dates picker while
 * `enabled` and the other end is known, the plain date picker otherwise. Make
 * it once per pill, outside its render, so a save never remounts an open
 * picker.
 */
export function startDueEditorFor(options: {
  field: DateField;
  enabled: Accessor<boolean>;
  other: Accessor<DateProperty | undefined>;
  saveOther: StartDueEditorProps['saveOther'];
  /** `StartDueSheetEditor` inside a touch sheet. */
  editor?: Component<StartDueEditorProps>;
  /** The editor while the dates picker is off; `Property.SheetEditor` in a sheet. */
  fallback?: typeof PopoverEditor;
}) {
  return (props: ComponentProps<typeof PopoverEditor>) => (
    <Show
      when={options.enabled() && options.other()}
      fallback={
        <Dynamic component={options.fallback ?? PopoverEditor} {...props} />
      }
    >
      {(end) => (
        <Dynamic
          component={options.editor ?? StartDueEditor}
          field={options.field}
          other={() => options.other() ?? end()}
          saveOther={options.saveOther}
        />
      )}
    </Show>
  );
}
