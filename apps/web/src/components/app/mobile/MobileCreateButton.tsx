import CreateIcon from '@icon/system/regular/plus.svg';
import { MobileDockIsland } from './MobileDockIsland';

/** Shared labeled creation pill above the mobile navigation dock. */
export function MobileCreateButton(props: {
  label: string;
  ariaLabel?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <MobileDockIsland class="shrink-0">
      <button
        type="button"
        aria-label={props.ariaLabel ?? props.label}
        disabled={props.disabled}
        onClick={props.onClick}
        class="relative flex h-(--mobile-chrome-button-size) shrink-0 items-center justify-center gap-1.5 rounded-full pl-3 pr-4 text-base font-medium whitespace-nowrap disabled:opacity-50"
      >
        <CreateIcon class="size-5.5 shrink-0" />
        <span>{props.label}</span>
      </button>
    </MobileDockIsland>
  );
}
