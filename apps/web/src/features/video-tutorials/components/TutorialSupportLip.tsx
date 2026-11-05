import { t } from '@app/lib/i18n';
import { Button } from '@ui';

/**
 * The strip under the video, on the dialog's own surface: "Have questions
 * about Macro CRM? Talk to us in your support channel."
 */
export function TutorialSupportLip(props: {
  /** The block the video teaches, like "Macro CRM". */
  block: string;
  /** Whether the person has a support channel, or support is reached by email. */
  hasChannel: boolean;
  onSelect: () => void;
}) {
  return (
    <p class="-mt-1 flex min-h-10 shrink-0 flex-wrap items-center justify-center px-4 pb-1 text-center text-sm text-ink-muted mobile:mt-0 mobile:pt-2">
      <span>{t('tutorials.supportQuestion', { block: props.block })}</span>
      <Button variant="link" size="sm" onClick={props.onSelect}>
        {props.hasChannel
          ? t('tutorials.supportChannel')
          : t('tutorials.supportEmail')}
      </Button>
    </p>
  );
}
