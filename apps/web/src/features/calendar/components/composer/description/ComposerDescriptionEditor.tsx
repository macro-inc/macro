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
> & { initialValue: string; inputRef?: (element: HTMLDivElement) => void };

export function ComposerDescriptionEditor(
  props: ComposerDescriptionEditorProps
) {
  const model = useCalendarComposer();
  const description = createComposerDescription(props.initialValue, (value) =>
    model.controller.setField('description', value)
  );
  return (
    <TextField.Surface class="max-h-52 overflow-y-auto">
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
        class="min-h-10 w-full bg-transparent text-sm text-ink outline-none"
      />
    </TextField.Surface>
  );
}
