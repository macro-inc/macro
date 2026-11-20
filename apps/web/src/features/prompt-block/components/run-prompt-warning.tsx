import { t } from '@app/lib/i18n';

/** The confirmation copy, with the whole prompt so it can be read before it runs. */
export function RunPromptWarning(props: { prompt: string }) {
  return (
    <div class="flex min-w-0 flex-col gap-3">
      <p>{t('promptBlock.confirmBody')}</p>
      <pre class="max-h-48 overflow-y-auto whitespace-pre-wrap wrap-anywhere rounded-lg border border-edge-muted bg-inset p-2.5 font-sans text-sm text-ink">
        {props.prompt}
      </pre>
    </div>
  );
}
