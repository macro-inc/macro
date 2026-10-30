import { t } from '@app/lib/i18n';
import { type JSX, Show } from 'solid-js';
import type { Bounds, ZoomDetail } from '../core/camera';
import type { BoardZone } from '../core/item';
import { ZoneTitle, zoneColor } from './glyphs';

/**
 * A neighborhood's region: a faint tint of the zone's hue behind its items,
 * titled at the top. Zoomed far out, the title grows above the region like
 * a place name on a map.
 */
export function ZoneFrame(props: {
  zone: BoardZone;
  bounds: Bounds;
  count: number;
  unread?: number;
  detail: ZoomDetail;
  /** Replaces the zone name, e.g. for people groups. */
  title?: JSX.Element;
}) {
  return (
    <div
      aria-hidden="true"
      class="pointer-events-none absolute rounded-[28px] border border-[color-mix(in_oklch,var(--board-zone)_24%,transparent)] bg-[color-mix(in_oklch,var(--board-zone)_5%,transparent)]"
      style={{
        '--board-zone': zoneColor(props.zone),
        left: `${props.bounds.x}px`,
        top: `${props.bounds.y}px`,
        width: `${props.bounds.width}px`,
        height: `${props.bounds.height}px`,
      }}
    >
      <Show
        when={props.detail === 'far'}
        fallback={
          <div class="flex h-11.5 items-center gap-3 px-4 text-sm">
            {props.title ?? <ZoneTitle zone={props.zone} count={props.count} />}
            <Show when={props.unread}>
              {(unread) => (
                <span class="text-xs font-medium text-accent">
                  {t('board.newCount', { count: unread() })}
                </span>
              )}
            </Show>
          </div>
        }
      >
        <div class="absolute bottom-full left-0 flex w-full items-end px-4 pb-4 text-[44px] leading-none whitespace-nowrap">
          {props.title ?? <ZoneTitle zone={props.zone} count={props.count} />}
        </div>
      </Show>
    </div>
  );
}

/**
 * A neighborhood as a soft glow of its hue, its name on a pill at the top
 * edge. The pill grows as the board zooms out so it stays legible.
 */
export function ZoneGlow(props: {
  zone: BoardZone;
  x: number;
  y: number;
  r: number;
  count: number;
  labelScale: number;
}) {
  return (
    <div
      aria-hidden="true"
      class="pointer-events-none absolute rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--board-zone)_13%,transparent),color-mix(in_oklch,var(--board-zone)_5%,transparent)_70%,transparent)]"
      style={{
        '--board-zone': zoneColor(props.zone),
        left: `${props.x - props.r}px`,
        top: `${props.y - props.r}px`,
        width: `${props.r * 2}px`,
        height: `${props.r * 2}px`,
      }}
    >
      <div
        class="absolute top-0 left-1/2 w-max origin-center -translate-1/2 rounded-full border border-[color-mix(in_oklch,var(--board-zone)_30%,transparent)] bg-panel px-3 py-1.5 text-sm shadow-sm"
        style={{ scale: String(props.labelScale) }}
      >
        <ZoneTitle zone={props.zone} count={props.count} />
      </div>
    </div>
  );
}
