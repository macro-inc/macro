import { t } from '@app/lib/i18n';
import { MarkdownTextarea } from '@core/component/LexicalMarkdown/component/core/MarkdownTextarea';
import type { ComponentProps } from 'solid-js';
import { useCalendarComposer } from '../../../context/calendar-composer-context';
import { createComposerDescription } from '../../../primitives/create-composer-description';
import { exportCalendarDescription } from '../../../utils/calendar-description';

export type ComposerDescriptionEditorProps = Pick<
  ComponentProps<typeof MarkdownTextarea>,
  'resolveAppLink'
> & { initialValue: string };

export function ComposerDescriptionEditor(
  props: ComposerDescriptionEditorProps
) {
  const model = useCalendarComposer();
  const description = createComposerDescription(props.initialValue, (value) =>
    model.controller.setField('description', value)
  );
  return (
    <div class="min-h-12 max-h-52 w-full overflow-y-auto rounded-lg border border-transparent bg-ink/6 focus-within:border-input-focus">
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
        domRef={(element) =>
          element.setAttribute('aria-label', t('calendar.description'))
        }
        class="min-h-12 w-full bg-transparent px-2.5 py-1 text-sm text-ink outline-none"
      />
    </div>
  );
}
