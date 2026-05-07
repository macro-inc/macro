import User from '@phosphor-icons/core/regular/user.svg?component-solid';
import { cn } from '@ui';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  Show,
} from 'solid-js';
import { Tooltip } from './Tooltip';
import type { UserIconProps } from './UserIcon';

/** Same keys as {@link UserIconProps} `size` (aligned ring + overlap + overflow chip). */
export type StackedAvatarsSize = NonNullable<UserIconProps['size']>;

/** `distribute="fill"`: face + chip footprint in px (matches Tailwind `size-*` at default rem). */
const AVATAR_DIAMETER_PX: Record<StackedAvatarsSize, number> = {
  sm: 16,
  md: 24,
  lg: 40,
  fill: 24,
};

/** Horizontal row shell: stacking context (`isolate`). */
export const STACKED_AVATARS_ROW_CLASS =
  'flex items-center h-full shrink-0 w-fit isolate leading-none min-w-0';

export type StackedAvatarsOverflowContext<T = unknown> = {
  overflowItems: T[];
  overflowCount: number;
};

/**
 * Ring, overlap, and +N chip track {@link UserIcon} `sizeClasses().container` widths.
 * `fill` uses the md footprint (intrinsic fill still needs a sized parent for `UserIcon`).
 */
const STACK_STYLE: Record<
  StackedAvatarsSize,
  {
    overlap: string;
    overflowChip: string;
    overflowChipText: string;
    inner: string;
    /** Muted empty-slot user icon (same scale as in-call avatar placeholder shells). */
    defaultEmptyIcon: string;
  }
> = {
  sm: {
    overlap: '-mr-1.5',
    overflowChip:
      'size-4 shrink-0 rounded-full border-2 border-panel bg-menu flex flex-col items-center justify-center',
    overflowChipText:
      'text-[8px] font-semibold tabular-nums leading-none text-ink',
    inner:
      'bg-panel size-4 rounded-full p-[1px] border-2 border-panel box-border',
    defaultEmptyIcon: 'w-2 h-2',
  },
  md: {
    overlap: '-mr-2',
    overflowChip:
      'size-6 shrink-0 rounded-full border-2 border-panel bg-menu flex flex-col items-center justify-center',
    overflowChipText:
      'text-[10px] font-semibold tabular-nums leading-none text-ink',
    inner:
      'bg-panel size-6 rounded-full p-[2px] border-2 border-panel box-border',
    defaultEmptyIcon: 'w-3 h-3',
  },
  lg: {
    overlap: '-mr-4',
    overflowChip:
      'size-10 shrink-0 rounded-full border-2 border-panel bg-menu flex flex-col items-center justify-center',
    overflowChipText:
      'text-sm font-semibold tabular-nums leading-none text-ink',
    inner:
      'bg-panel size-10 rounded-full p-[2px] border-2 border-panel box-border',
    defaultEmptyIcon: 'w-5 h-5',
  },
  fill: {
    overlap: '-mr-2',
    overflowChip:
      'size-6 shrink-0 rounded-full border-2 border-panel bg-menu flex flex-col items-center justify-center',
    overflowChipText:
      'text-[10px] font-semibold tabular-nums leading-none text-ink',
    inner:
      'bg-panel size-6 rounded-full p-[2px] border-2 border-panel box-border',
    defaultEmptyIcon: 'w-3 h-3',
  },
};

/** Inner ring around `UserIcon` (no overlap margin — the row applies overlap on a wrapper). */
export function stackedAvatarInnerClass(size: StackedAvatarsSize = 'sm') {
  return STACK_STYLE[size].inner;
}

/** Default +N chip shell (no text); pair with {@link stackedAvatarOverflowChipTextClass}. */
export function stackedAvatarOverflowChipClass(
  size: StackedAvatarsSize = 'sm'
) {
  return STACK_STYLE[size].overflowChip;
}

export function stackedAvatarOverflowChipTextClass(
  size: StackedAvatarsSize = 'sm'
) {
  return STACK_STYLE[size].overflowChipText;
}

/**
 * Muted user-in-ring placeholder: same outer ring as stacked faces
 * ({@link stackedAvatarInnerClass}); icon scales with `size`.
 */
export function StackedAvatarsDefaultEmptyPlaceholder(props: {
  size?: StackedAvatarsSize;
}) {
  const s = () => props.size ?? 'md';
  return (
    <div class={stackedAvatarInnerClass(s())}>
      <div class="flex size-full min-h-0 min-w-0 items-center justify-center overflow-hidden rounded-full bg-ink-extra-muted text-panel leading-none">
        <User
          class={cn(STACK_STYLE[s()].defaultEmptyIcon, 'block shrink-0')}
          aria-hidden
        />
      </div>
    </div>
  );
}

export type StackedAvatarInput = {
  userId: string;
  tooltip?: string;
  onPress?: () => void;
  ariaLabel?: string;
};

export type StackedAvatarsRowProps<T = unknown> = {
  each: Accessor<T[]>;
  max: number | Accessor<number>;
  size?: StackedAvatarsSize;
  /** Shown when `each()` is empty (e.g. connecting); if truthy, overrides `defaultEmptyUserPlaceholder`. */
  placeholder?: Accessor<JSX.Element | undefined | null | false>;
  /** When the list is empty and `placeholder` is unset or falsy, show the built-in muted user ring at `size`. */
  defaultEmptyUserPlaceholder?: boolean;
  /** Face slot; use `UserIcon` with `showTooltip={false}` if you add your own `Tooltip`. */
  children: (item: T, index: number) => JSX.Element;
  /** Plain tooltip on the +N chip when not using `overflowTooltipContent`. */
  overflowTooltip?:
    | string
    | ((ctx: StackedAvatarsOverflowContext<T>) => string | undefined);
  overflowTooltipContent?: (
    close: () => void,
    ctx: StackedAvatarsOverflowContext<T>
  ) => JSX.Element;
  overflowWrap?: (
    ctx: StackedAvatarsOverflowContext<T> & { chip: JSX.Element }
  ) => JSX.Element;
  renderOverflow?: (ctx: StackedAvatarsOverflowContext<T>) => JSX.Element;
  overflowChipClass?: string;
  overflowChipLabelClass?: string;
  class?: string;
  /**
   * `fill`: when `each().length >= max`, ResizeObserver + per-gap `margin-right` so the strip
   * spans the row (below that count, behaves like `pack`). `pack`: fixed overlap from `size`.
   */
  distribute?: 'pack' | 'fill';
};

function maxValue(max: number | Accessor<number>) {
  return typeof max === 'function' ? max() : max;
}

function defaultOverflowChip(
  size: StackedAvatarsSize,
  overflowCount: number,
  chipClass?: string,
  labelClass?: string
): JSX.Element {
  return (
    <div
      class={cn(stackedAvatarOverflowChipClass(size), chipClass)}
      data-ui="stacked-avatars-overflow-chip"
    >
      <span
        class={cn(stackedAvatarOverflowChipTextClass(size), labelClass)}
      >{`+${overflowCount}`}</span>
    </div>
  );
}

export function StackedAvatarsRow<T = unknown>(
  props: StackedAvatarsRowProps<T>
) {
  const size = () => props.size ?? 'sm';

  const distributeFill = () => props.distribute === 'fill';

  const [rowEl, setRowEl] = createSignal<HTMLDivElement | null>(null);
  const [rowWidth, setRowWidth] = createSignal(0);

  const all = createMemo(() => props.each());

  const maxed = () => {
    const m = maxValue(props.max);
    if (!Number.isFinite(m) || m < 0) return 0;
    return m;
  };

  /** `distribute="fill"` only affects layout at or above the `max` slot cap. */
  const useFillWidthLayout = createMemo(
    () => distributeFill() && all().length >= maxed()
  );

  createEffect(() => {
    const el = rowEl();
    if (!useFillWidthLayout() || !el) return;
    const ro = new ResizeObserver(() => {
      setRowWidth(el.clientWidth);
    });
    ro.observe(el);
    setRowWidth(el.clientWidth);
    onCleanup(() => ro.disconnect());
  });

  const visible = createMemo(() => all().slice(0, maxed()));

  const overflow = createMemo(() => all().slice(maxed()));

  const overflowCount = createMemo(() => overflow().length);

  const overflowCtx = createMemo(
    (): StackedAvatarsOverflowContext<T> => ({
      overflowItems: overflow(),
      overflowCount: overflowCount(),
    })
  );

  const plainOverflowTooltip = createMemo(() => {
    const ctx = overflowCtx();
    const ot = props.overflowTooltip;
    if (typeof ot === 'string') return ot;
    if (typeof ot === 'function') return ot(ctx) ?? '';
    return `${ctx.overflowCount} more`;
  });

  const overlap = () => STACK_STYLE[size()].overlap;

  /**
   * Per-gap `margin-right` between consecutive stack slots so the row fills `rowWidth`
   * (negative = overlap, positive = gap).
   */
  const fillStepMarginPx = createMemo(() => {
    if (!useFillWidthLayout()) return null;

    const rowWidthPx = rowWidth();
    const visibleFaces = visible();
    const overflowFaceCount = overflowCount();
    const slotCount = visibleFaces.length + (overflowFaceCount > 0 ? 1 : 0);
    const faceDiameterPx = AVATAR_DIAMETER_PX[size()];

    if (slotCount < 2 || rowWidthPx < 1) return null;

    const gapCount = slotCount - 1;
    let marginRightPerGapPx =
      (rowWidthPx - slotCount * faceDiameterPx) / gapCount;
    const minMarginRightPx = -(faceDiameterPx - 6);
    const maxMarginRightPx = Math.max(24, Math.round(faceDiameterPx * 0.45));
    marginRightPerGapPx = Math.max(
      minMarginRightPx,
      Math.min(maxMarginRightPx, marginRightPerGapPx)
    );

    return marginRightPerGapPx;
  });

  const faceWrapperClass = (lastNoOverflowChip: boolean) =>
    cn(
      'relative shrink-0',
      !(useFillWidthLayout() && fillStepMarginPx() !== null) && overlap(),
      !(useFillWidthLayout() && fillStepMarginPx() !== null) &&
        lastNoOverflowChip &&
        'mr-0!'
    );

  const faceWrapperStyle = (
    index: number,
    lastNoOverflowChip: boolean
  ): JSX.CSSProperties | undefined => {
    const stackingStyle: JSX.CSSProperties = {
      'z-index': String(10 + index),
    };
    if (!useFillWidthLayout()) return stackingStyle;
    const marginRightPerGapPx = fillStepMarginPx();
    if (marginRightPerGapPx === null) return stackingStyle;
    const lastVisibleIndex = visible().length - 1;
    let slotMarginRightPx = marginRightPerGapPx;
    if (lastNoOverflowChip) slotMarginRightPx = 0;
    else if (index === lastVisibleIndex && overflowCount() === 0) {
      slotMarginRightPx = 0;
    }
    return { ...stackingStyle, 'margin-right': `${slotMarginRightPx}px` };
  };

  const placeholderEl = createMemo(() => {
    if (all().length > 0) return undefined;
    const custom = props.placeholder?.();
    if (custom) return custom;
    if (props.defaultEmptyUserPlaceholder) {
      return <StackedAvatarsDefaultEmptyPlaceholder size={size()} />;
    }
    return undefined;
  });

  const overflowSlot = () => {
    if (overflowCount() === 0) return null;

    const ctx = overflowCtx();
    const overflowSlotZIndex = String(10 + visible().length);
    const faceShell = (inner: JSX.Element) => (
      <div class="relative shrink-0" style={{ 'z-index': overflowSlotZIndex }}>
        {inner}
      </div>
    );

    if (props.renderOverflow) {
      return faceShell(props.renderOverflow(ctx));
    }

    const chip = defaultOverflowChip(
      size(),
      ctx.overflowCount,
      props.overflowChipClass,
      props.overflowChipLabelClass
    );

    if (props.overflowWrap) {
      return faceShell(props.overflowWrap({ ...ctx, chip }));
    }

    if (props.overflowTooltipContent) {
      return faceShell(
        <Tooltip
          unstyled
          tooltip={(close) => props.overflowTooltipContent!(close, ctx)}
        >
          {chip}
        </Tooltip>
      );
    }

    return faceShell(
      <Tooltip tooltip={plainOverflowTooltip()}>{chip}</Tooltip>
    );
  };

  return (
    <div
      ref={setRowEl}
      class={cn(STACKED_AVATARS_ROW_CLASS, props.class)}
      data-ui="stacked-avatars-row"
    >
      <Show when={all().length === 0}>
        <Show when={placeholderEl()}>
          <div class="relative mr-0 shrink-0">{placeholderEl()}</div>
        </Show>
      </Show>
      <Show when={all().length > 0}>
        <For each={visible()}>
          {(item, index) => {
            const lastNoOverflowChip =
              index() === visible().length - 1 && overflowCount() === 0;
            return (
              <div
                class={faceWrapperClass(lastNoOverflowChip)}
                style={faceWrapperStyle(index(), lastNoOverflowChip)}
              >
                {props.children(item, index())}
              </div>
            );
          }}
        </For>
        <Show when={overflowCount() > 0}>{overflowSlot()}</Show>
      </Show>
    </div>
  );
}
