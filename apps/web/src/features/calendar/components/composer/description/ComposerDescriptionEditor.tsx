import { t } from '@app/lib/i18n';
import { MarkdownTextarea } from '@core/component/LexicalMarkdown/component/core/MarkdownTextarea';
import { TextField } from '@ui';
import type { ComponentProps } from 'solid-js';
import { useCalendarComposer } from '../../../context/calendar-composer-context';
import { createComposerDescription } from '../../../primitives/create-composer-description';
import { exportCalendarDescription } from '../../../utils/calendar-description';

export type ComposerDescriptionEditorProps = Pick<
  ComponentProps<typeof MarkdownTextarea>,
  'resolveAppLink'
> & {
  initialValue: string;
  inputRef?: (element: HTMLDivElement) => void;
  minLines?: number;
  plain?: boolean;
};

export function ComposerDescriptionEditor(
  props: ComposerDescriptionEditorProps
) {
  const model = useCalendarComposer();
  const description = createComposerDescription(props.initialValue, (value) =>
    model.controller.setField('description', value)
  );
  return (
    <TextField.Surface
      class={
        props.plain
          ? 'min-h-0 max-h-32 overflow-y-auto rounded-lg border-0 bg-transparent px-3 py-1 shadow-none hover:bg-hover focus-within:bg-active'
          : 'focus-within:border-accent focus-within:ring-[1.5px] focus-within:ring-accent'
      }
      style={{
        '--composer-description-min-height': props.plain
          ? '1.25rem'
          : props.minLines
            ? `${props.minLines * 1.25 + 0.75}rem`
            : '2.5rem',
      }}
    >
      <MarkdownTextarea
        type="calendar"
        initialHtml={description.initialHtml}
        editable={() => !model.fieldIsDisabled('description')}
        onInitialized={(editor) =>
          description.initialized(exportCalendarDescription(editor))
        }
        onChange={(_markdown, editor) => {
          if (editor) description.changed(exportCalendarDescription(editor));
        }}
        resolveAppLink={props.resolveAppLink}
        placeholder={t('calendar.addDescription')}
        portalScope="local"
        domRef={(element) => {
          element.setAttribute('aria-label', t('calendar.description'));
          props.inputRef?.(element);
        }}
        class="min-h-(--composer-description-min-height) [&>[contenteditable]]:min-h-(--composer-description-min-height) w-full bg-transparent text-sm text-ink outline-none"
      />
    </TextField.Surface>
  );
}
