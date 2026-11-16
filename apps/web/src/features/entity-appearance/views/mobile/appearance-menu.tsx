import { t } from '@app/lib/i18n';
import { MenuItem } from '@core/component/ContextMenu';
import PaintBrushIcon from '@icon/system/regular/paint-brush.svg';

export function MobileAppearanceMenu(props: { onSelect: () => void }) {
  return (
    <MenuItem
      text={t('appearance.title')}
      icon={PaintBrushIcon}
      onClick={props.onSelect}
    />
  );
}
