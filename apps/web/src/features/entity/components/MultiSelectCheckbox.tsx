import { t } from '@app/lib/i18n';
import { cn, InlineCheckbox } from '@ui';

interface MultiSelectCheckboxProps {
  checked?: boolean;
  showBorder?: boolean;
  onChecked?: (checked: boolean, shiftKey: boolean) => void;
}

/**
 * List selection toggle with a shared checkbox indicator. Layouts decide when
 * it replaces the row icon or unread indicator; the button keeps the full-cell
 * hit target and forwards shift-click selection.
 */
export function MultiSelectCheckbox(props: MultiSelectCheckboxProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={!!props.checked}
      aria-label={t('common.selectItem')}
      class="size-full relative group/button flex items-center justify-center"
      onMouseDown={(e) => {
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.stopPropagation();
        props.onChecked?.(!props.checked, e.shiftKey);
      }}
      data-blocks-navigation
    >
      <span
        class={cn(
          'pointer-events-none flex items-center justify-center',
          !props.checked &&
            !props.showBorder &&
            'opacity-0 group-hover/button:opacity-100 group-focus-visible/button:opacity-100'
        )}
      >
        <InlineCheckbox checked={!!props.checked} size="md" />
      </span>
    </button>
  );
}
