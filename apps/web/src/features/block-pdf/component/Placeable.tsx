import {
  useCurrentScale,
  useGetPopupContextViewer,
  useIsPopup,
  useVisiblePages,
} from '@block-pdf/signal/pdfViewer';
import { activePlaceableIdSignal } from '@block-pdf/signal/placeables';
import { activeCommentThreadSignal } from '@block-pdf/store/comments/commentStore';
import { isThreadPlaceable } from '@block-pdf/store/comments/freeComments';
import { useUpdatePlaceablePosition } from '@block-pdf/store/placeables';
import { type IPlaceable, PayloadMode } from '@block-pdf/type/placeables';
import { getPdfPageRect } from '@block-pdf/util/pdfjsUtils';
import { PDF_TO_CSS_UNITS } from '@block-pdf/util/pixelsPerInch';
import { createBlockSignal } from '@core/block';
import { setEquals } from '@core/util/compareUtils';
import { isInDOMRect } from '@core/util/rect';
import { debounce } from '@solid-primitives/scheduled';
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
  untrack,
} from 'solid-js';
import {
  FreeCommentPlaceable,
  NewFreeCommentPlaceable,
} from './placeables/FreeCommentPlaceable';
import { Signature } from './placeables/Signature';
import { TextBox } from './placeables/TextBox';

const isPopupDragSignal = createBlockSignal<boolean>(false);

export const Placeable: Component<{
  pageNum: number;
  isNew: boolean;
  isActive: boolean;
  placeable: IPlaceable;
  id: string;
  canEdit: boolean;
}> = (props) => {
  const getViewer = useGetPopupContextViewer();

  const [textAreaRef, setTextAreaRef] = createSignal<HTMLTextAreaElement>();
  let placeableRef!: HTMLDivElement;
  let parentPageOverlayContainer!: HTMLDivElement;
  let viewerEl!: HTMLElement;

  const parentId = () => props.pageNum + 1;

  const visiblePages = useVisiblePages();
  const visiblePageNumbers = createMemo((prev: Set<number>) => {
    const visiblePageIds = visiblePages()?.ids ?? new Set();
    const equals = setEquals(prev, visiblePageIds);
    if (equals) return prev;
    return visiblePageIds;
  }, new Set());

  const updatePlaceablePosition = useUpdatePlaceablePosition();
  const setActivePlaceableId = activePlaceableIdSignal.set;
  const setActiveCommentThreadId = activeCommentThreadSignal.set;

  const isPopup = useIsPopup();
  const [isPopupDrag, setIsPopupDrag] = isPopupDragSignal;

  const [mousePosition, setMousePosition] = createSignal({ x: 0, y: 0 });
  const [dragOffset, setDragOffset] = createSignal({ x: 0, y: 0 });
  const [clickOffset, setClickOffset] = createSignal({ x: 0, y: 0 });
  let mouseDownTimeout: ReturnType<typeof setTimeout>;
  const setMouseUp = () => {
    _setMouseDown(false);
    clearTimeout(mouseDownTimeout);
  };
  const setMouseDown = (e: MouseEvent) => {
    setActivePlaceableId(props.id);
    setIsResizing(undefined);
    setClickOffset({
      x: e.clientX - xCoord(),
      y: e.clientY - yCoord(),
    });
    mouseDownTimeout = setTimeout(() => {
      _setMouseDown(true);
    }, 100);
  };
  const [mouseDown, _setMouseDown] = createSignal(false);
  const [placeableIntersectsViewer, setPlaceableIntersectsViewer] =
    createSignal(true);
  const [intersectingPage, setIntersectingPage] = createSignal<number>(
    parentId()
  );
  const [pdfPageRects, setPdfPageRects] = createSignal<Record<string, DOMRect>>(
    {}
  );

  const [mouseMoveEvent, setMouseMoveEvent] = createSignal<
    MouseEvent | undefined
  >();
  let maybeResizeTimeout: ReturnType<typeof setTimeout>;
  let firstObserve = false;
  // undefined = pending state, true = resizing, false = dragging
  const [isResizing, setIsResizing] = createSignal<boolean | undefined>();
  const [resizeDimensions, setResizeDimensions] = createSignal<
    { width: number; height: number } | undefined
  >();

  onMount(() => {
    const viewer = getViewer();
    if (!viewer) {
      console.error('No viewer found');
      return;
    }

    parentPageOverlayContainer =
      viewer.pageOverlayContainersByPage[props.pageNum];
    const parentPageIntersectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIntersectingPage(parentId());
          } else {
            setIntersectingPage((prev) => (prev === parentId() ? -1 : prev));
          }
        });
      },
      {
        root: parentPageOverlayContainer,
        threshold: 1,
      }
    );

    viewerEl = viewer.viewerElement() as HTMLDivElement;
    const viewerIntersectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setPlaceableIntersectsViewer(true);
          } else {
            setPlaceableIntersectsViewer(false);
          }
        });
      },
      {
        root: viewerEl,
        threshold: 1,
      }
    );

    parentPageIntersectionObserver.observe(placeableRef);
    viewerIntersectionObserver.observe(placeableRef);

    onCleanup(() => {
      parentPageIntersectionObserver.disconnect();
      viewerIntersectionObserver.disconnect();
    });
  });

  // this lets us change the bounding rects on scroll/zoom
  createEffect(() => {
    if (!visiblePages()) return;
    setPdfPageRects({});
  });

  createEffect(() => {
    if (intersectingPage() === parentId()) return;

    const unobservedPageNums = [...visiblePageNumbers()].filter(
      (n) => n !== parentId()
    );

    const { x, y } = mousePosition();

    let maybeIntersectingPage = -1;
    for (const pageNum of unobservedPageNums) {
      let pdfPageRect = untrack(pdfPageRects)[pageNum];

      if (!pdfPageRect) {
        const pdfPageRect_ = getPdfPageRect({ pageNum: pageNum, viewerEl });
        if (!pdfPageRect_) continue;

        pdfPageRect = pdfPageRect_;
        setPdfPageRects((prev) => ({ ...prev, [pageNum]: pdfPageRect }));
      }

      if (isInDOMRect(pdfPageRect, x, y, width(), height())) {
        maybeIntersectingPage = pageNum;
        break;
      }
    }

    setIntersectingPage(maybeIntersectingPage);
  });

  const onMouseMoveDrag = (e: MouseEvent) => {
    if (!props.canEdit) return;
    if (!mouseDown()) return;
    if (isResizing()) return;
    setActivePlaceableId(props.id);

    let pdfPageX = e.clientX;
    let pdfPageY = e.clientY;
    // prevent the placeable from being dragged outside the viewer bounds
    if (!placeableIntersectsViewer()) {
      const viewerRect = viewerEl.getBoundingClientRect();

      pdfPageX = Math.max(
        viewerRect.left,
        Math.min(e.clientX, viewerRect.right)
      );
      pdfPageY = Math.max(
        viewerRect.top,
        Math.min(e.clientY, viewerRect.bottom)
      );
    }
    const { x: clickOffsetX, y: clickOffsetY } = clickOffset();
    const deltaX = pdfPageX - clickOffsetX - xCoord();
    const deltaY = pdfPageY - clickOffsetY - yCoord();

    setMousePosition({
      x: e.clientX,
      y: e.clientY,
    });
    setDragOffset({
      x: deltaX,
      y: deltaY,
    });

    placeableRef.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
  };

  const resetPlaceablePosition = () => {
    placeableRef.style.transform = '';
    setDragOffset({
      x: 0,
      y: 0,
    });
    setMouseUp();
  };

  const onMouseMove = (e: MouseEvent) => {
    // bypass the create effect and call the drag handler directly
    if (textAreaRef() === undefined) {
      onMouseMoveDrag(e);
      return;
    }

    setMouseMoveEvent(e);
    if (!mouseDown() || isResizing() !== undefined) {
      return;
    }
    maybeResizeTimeout = setTimeout(() => {
      setIsResizing(false);
    }, 50);
  };

  createEffect(() => {
    const event = mouseMoveEvent();
    const isResizing_ = isResizing();
    const isDragging = isResizing_ !== undefined && !isResizing_;
    if (isDragging && event) {
      onMouseMoveDrag(event);
    }
  });

  createEffect(() => {
    const { x, y } = dragOffset();
    const hasPressed = mouseDown();
    const hasMoved = x !== 0 || y !== 0;
    setIsPopupDrag(hasPressed || hasMoved);
  });

  onMount(() => {
    const resetPlaceable = (e: MouseEvent) => {
      if (!props.canEdit) return;
      if (!props.isActive) return;

      const isDragged =
        mouseDown() && !(dragOffset().x === 0 && dragOffset().y === 0);
      const otherPlaceableDragged =
        (!isPopup && isPopupDrag()) || (isPopup && !isPopupDrag());

      if (!isDragged && otherPlaceableDragged) return;

      // outside click
      if (!isDragged) {
        setActivePlaceableId(undefined);
        return;
      }

      // prevents the comment click outside handler from triggering after
      // the effect handler resets the blocking on drag position reset
      e.stopImmediatePropagation();

      resetPlaceablePosition();
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', resetPlaceable);
    onCleanup(() => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', resetPlaceable);
    });
  });

  createEffect(() => {
    const ref = textAreaRef();
    if (!ref) return;
    const resizeObserver = new ResizeObserver((entries) => {
      if (!firstObserve) {
        firstObserve = true;
        return;
      }

      const rect = entries[0].contentRect;
      setResizeDimensions({ width: rect.width, height: rect.height });

      if (isResizing() !== undefined) return;

      setIsResizing(true);
      clearTimeout(maybeResizeTimeout);
    });
    resizeObserver.observe(ref);
    onCleanup(() => {
      resizeObserver.disconnect();
    });
  });

  const currentScale = useCurrentScale();
  const scale = createMemo(
    () =>
      getViewer()?.getScale({ pageNumber: 1 })?.scale ??
      currentScale() * PDF_TO_CSS_UNITS
  );
  const invScale = () => 100 / scale();
  const unscaled = createMemo(
    () =>
      getViewer()?.pageDimensions(props.pageNum, false) ?? {
        width: 0,
        height: 0,
      }
  );
  const scaledPageWidth = () => Math.floor(unscaled().width * scale());
  const scaledPageHeight = () => Math.floor(unscaled().height * scale());
  const xCoord = () => props.placeable.position.xPct * scaledPageWidth();
  const yCoord = () => props.placeable.position.yPct * scaledPageHeight();
  const width = () => {
    return props.placeable.position.widthPct * scaledPageWidth();
  };
  const height = () => {
    return props.placeable.position.heightPct * scaledPageHeight();
  };

  const debouncedUpdatePlaceablePosition = debounce(
    (...args: Parameters<typeof updatePlaceablePosition>) => {
      updatePlaceablePosition(...args);
      resetPlaceablePosition();
    },
    100
  );
  createEffect(() => {
    const rect = resizeDimensions();
    if (!rect) return;
    const widthPct = rect.width / scaledPageWidth();
    const heightPct = rect.height / scaledPageHeight();
    debouncedUpdatePlaceablePosition(props.id, {
      widthPct,
      heightPct,
    });
  });

  return (
    <div
      ref={placeableRef}
      class="absolute z-placeable"
      style={{
        left: `${xCoord().toString()}px`,
        top: `${yCoord().toString()}px`,
        width: `${width().toString()}px`,
        height: `${height().toString()}px`,
        opacity: intersectingPage() === -1 ? 0.3 : 1,
      }}
      on:click={(e) => {
        e.stopPropagation();
      }}
      on:dragstart={() => {
        return false;
      }}
      on:mousedown={(e) => {
        e.stopPropagation();
        if (!props.canEdit) return;

        if (!isThreadPlaceable(props.placeable)) {
          setActiveCommentThreadId(null);
        }
        setMouseDown(e);
      }}
      on:mouseup={(e) => {
        e.stopPropagation();
        if (!props.canEdit) return;

        if (!isResizing() && intersectingPage() !== -1) {
          let xPct, yPct;
          if (intersectingPage() === parentId()) {
            xPct = (xCoord() + dragOffset().x) / scaledPageWidth();
            yPct = (yCoord() + dragOffset().y) / scaledPageHeight();
          } else {
            // we need to update to the new page coordinate system
            const pageRect = pdfPageRects()[intersectingPage()];
            const { x, y } = mousePosition();
            xPct = (x - pageRect.left - width() / 2) / pageRect.width;
            yPct = (y - pageRect.top - height() / 2) / pageRect.height;
          }

          const pageNum = intersectingPage() - 1;
          debouncedUpdatePlaceablePosition(props.id, {
            xPct,
            yPct,
            pageNum,
          });
        }
      }}
    >
      <div
        class="absolute origin-center"
        style={{
          transform: `scale(${scale()})`,
          width: `${invScale()}%`,
          height: `${invScale()}%`,
          left: `${(100 - invScale()) / 2}%`,
          top: `${(100 - invScale()) / 2}%`,
        }}
      >
        <Switch>
          <Match when={isThreadPlaceable(props.placeable) && props.placeable}>
            {(threadPlaceable) => (
              <>
                <Show when={threadPlaceable().payload}>
                  {(payload) => <FreeCommentPlaceable payload={payload()} />}
                </Show>
                <Show when={threadPlaceable().payload == null}>
                  <NewFreeCommentPlaceable />
                </Show>
              </>
            )}
          </Match>
          {/* TODO: fix types */}
          <Match
            when={
              props.placeable.payloadType === PayloadMode.FreeTextAnnotation &&
              props.placeable.payload
            }
          >
            {(payload) => (
              <TextBox
                id={props.id}
                payload={payload()}
                isActive={props.isActive}
                allowableEdits={props.placeable.allowableEdits}
                ref={setTextAreaRef}
                initialWidth={width()}
                initialHeight={height()}
              />
            )}
          </Match>
          <Match
            when={
              props.placeable.payloadType === PayloadMode.Signature &&
              props.placeable.payload
            }
          >
            {(payload) => (
              <Signature
                id={props.id}
                base64={payload().base64}
                isActive={props.isActive}
                allowableEdits={props.placeable.allowableEdits}
                isNew={props.isNew}
              />
            )}
          </Match>
        </Switch>
      </div>
    </div>
  );
};
