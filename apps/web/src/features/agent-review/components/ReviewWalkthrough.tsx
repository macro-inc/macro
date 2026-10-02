import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { channelTheme } from '@core/component/LexicalMarkdown/theme';
import ArrowLeftIcon from '@phosphor/arrow-left.svg';
import ArrowRightIcon from '@phosphor/arrow-right.svg';
import { createElementSize } from '@solid-primitives/resize-observer';
import { Button } from '@ui';
import { createSignal } from 'solid-js';
import type { Chapter } from '../core/model';

export function ReviewWalkthrough(props: {
  chapter: Chapter;
  index: number;
  count: number;
  onChapter: (index: number) => void;
}) {
  const [panel, setPanel] = createSignal<HTMLDivElement>();
  const available = createElementSize(() => panel()?.parentElement);
  const panelSize = createElementSize(panel);
  const minimum = 68;
  const maximum = () => Math.max(minimum, (available.height ?? 600) * 0.65);
  const [height, setHeight] = createSignal<number>();
  const boundedHeight = () =>
    Math.max(
      minimum,
      Math.min(maximum(), height() ?? panelSize.height ?? minimum)
    );
  let drag: { y: number; height: number } | undefined;
  return (
    <div
      ref={setPanel}
      class="group/walkthrough relative flex shrink-0 flex-col bg-panel"
      style={{
        height: height() === undefined ? undefined : `${boundedHeight()}px`,
        'min-height': `${minimum}px`,
        'max-height': `${height() === undefined ? Math.min(160, maximum()) : maximum()}px`,
      }}
    >
      <div class="flex shrink-0 items-center gap-2 px-5 pt-3 pb-1">
        <h2
          class="min-w-0 flex-1 truncate text-sm font-medium"
          title={props.chapter.title}
        >
          {props.chapter.title}
        </h2>
        <span class="text-[10px] tabular-nums text-ink-subtle">
          {props.index + 1} / {props.count}
        </span>
        <Button
          size="icon-xs"
          variant="ghost"
          label="Previous chapter"
          disabled={props.index === 0}
          onClick={() => props.onChapter(props.index - 1)}
        >
          <ArrowLeftIcon />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          label="Next chapter"
          disabled={props.index + 1 >= props.count}
          onClick={() => props.onChapter(props.index + 1)}
        >
          <ArrowRightIcon />
        </Button>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto px-5 pb-2 text-[13px] leading-5 text-ink-muted">
        <StaticMarkdown
          autoLink
          markdown={props.chapter.description}
          theme={channelTheme}
          target="internal"
          lazy={false}
        />
      </div>
      <div
        role="separator"
        aria-label="Resize walkthrough"
        aria-orientation="horizontal"
        tabIndex={0}
        aria-valuemin={minimum}
        aria-valuemax={Math.round(maximum())}
        aria-valuenow={Math.round(boundedHeight())}
        title="Drag to resize · Double-click to reset"
        class="group/resize flex h-2 shrink-0 touch-none cursor-row-resize items-center justify-center outline-none hover:bg-hover focus-visible:bg-hover"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          drag = { y: event.clientY, height: boundedHeight() };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!drag) return;
          setHeight(
            Math.max(
              minimum,
              Math.min(maximum(), drag.height + event.clientY - drag.y)
            )
          );
        }}
        onPointerUp={(event) => {
          drag = undefined;
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onLostPointerCapture={() => {
          drag = undefined;
        }}
        onDblClick={() => setHeight(undefined)}
        onKeyDown={(event) => {
          if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key))
            return;
          event.preventDefault();
          event.stopPropagation();
          setHeight(
            event.key === 'Home'
              ? minimum
              : event.key === 'End'
                ? maximum()
                : Math.max(
                    minimum,
                    Math.min(
                      maximum(),
                      boundedHeight() + (event.key === 'ArrowDown' ? 24 : -24)
                    )
                  )
          );
        }}
      >
        <span class="h-0.5 w-8 rounded-full bg-edge opacity-0 transition-opacity group-hover/walkthrough:opacity-100 group-focus-visible/resize:opacity-100" />
      </div>
    </div>
  );
}
