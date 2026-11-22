import { t } from '@app/lib/i18n';
import ArrowsClockwiseIcon from '@icon/system/regular/arrows-clockwise.svg';

/** The ↻ on a face's corner: a new face in place, keeping its pins. */
export function ShuffleBadge(props: { onShuffle: () => void }) {
  return (
    <span class="absolute -right-1 -bottom-1 flex touch:-right-2 touch:-bottom-2">
      <button
        type="button"
        aria-label={t('agentFaces.shuffleFace')}
        class="flex size-6 items-center justify-center rounded-full border border-edge-muted bg-surface text-ink shadow-sm touch:size-7"
        onClick={() => props.onShuffle()}
      >
        <ArrowsClockwiseIcon class="size-3.5 touch:size-4" />
      </button>
    </span>
  );
}
