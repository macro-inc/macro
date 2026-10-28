import { formatLocale, t } from '@app/lib/i18n';
import CornersOutIcon from '@icon/system/regular/corners-out.svg';
import MinusIcon from '@icon/system/regular/minus.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import { Toolbar } from '@ui';
import { createMemo } from 'solid-js';

/** Zoom out, the current zoom, zoom in, and frame everything. */
export function ZoomToolbar(props: {
  scale: number;
  fitted: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
}) {
  const percent = createMemo(
    () =>
      new Intl.NumberFormat(formatLocale(), {
        style: 'percent',
        maximumFractionDigits: 0,
      })
  );
  return (
    <div data-board-overlay="" class="absolute bottom-4 left-4 z-30">
      <Toolbar size="icon-sm" aria-label={t('board.boardZoom')}>
        <Toolbar.Group>
          <Toolbar.Button label={t('board.zoomOut')} onClick={props.onZoomOut}>
            <MinusIcon />
          </Toolbar.Button>
          <output
            aria-label={t('board.zoomLevel')}
            class="min-w-11 text-center text-xs tabular-nums text-ink-muted"
          >
            {percent().format(props.scale)}
          </output>
          <Toolbar.Button label={t('board.zoomIn')} onClick={props.onZoomIn}>
            <PlusIcon />
          </Toolbar.Button>
        </Toolbar.Group>
        <Toolbar.Divider />
        <Toolbar.Button
          label={t('board.zoomToFit')}
          aria-pressed={props.fitted}
          onClick={props.onFit}
        >
          <CornersOutIcon />
        </Toolbar.Button>
      </Toolbar>
    </div>
  );
}
