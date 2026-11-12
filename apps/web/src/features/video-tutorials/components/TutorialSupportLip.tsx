import { t } from '@app/lib/i18n';
import { Avatar, AvatarGroup, Button } from '@ui';
import { For } from 'solid-js';
import presenterPhoto from '../assets/presenter.jpg';
import juliaPhoto from '../assets/support-julia.jpg';
import teoPhoto from '../assets/support-teo.jpg';

/** Three of the Macro team in every support channel, shown as faces only. */
const SUPPORT_TEAM_PHOTOS = [juliaPhoto, teoPhoto, presenterPhoto];

/**
 * The strip under the video, on the dialog's own surface: the faces of
 * people on the Macro team, overlapping like a block's live viewers, then
 * "Have questions about Macro CRM? Talk to us in your support channel."
 */
export function TutorialSupportLip(props: {
  /** The block the video teaches, like "Macro CRM". */
  block: string;
  onSelect: () => void;
}) {
  return (
    <div class="-mt-1 flex min-h-10 shrink-0 flex-wrap items-center justify-center px-4 pb-1 text-center text-sm text-ink-muted">
      {/* Decorative: they show there are real people in the channel. The
          separator rings take the dialog's surface, as the live viewers'
          take the header's. */}
      <AvatarGroup
        size="md"
        aria-hidden="true"
        class="mr-2.5 [--avatar-group-separator:var(--color-dialog)]"
      >
        <For each={SUPPORT_TEAM_PHOTOS}>
          {(photo) => (
            <Avatar size="md">
              <Avatar.Image src={photo} alt="" />
              <Avatar.Fallback />
            </Avatar>
          )}
        </For>
      </AvatarGroup>
      <span>{t('tutorials.supportQuestion', { block: props.block })}</span>
      <Button variant="link" size="sm" onClick={props.onSelect}>
        {t('tutorials.supportChannel')}
      </Button>
    </div>
  );
}
