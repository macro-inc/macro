import * as stackingContext from '@core/constant/stackingContext';
import {
  createEffect,
  createMemo,
  onCleanup,
  type ParentProps,
  type Ref,
  useContext,
} from 'solid-js';
import { CommentsContext, threadMeasureContainerId } from './Thread';

type MeasureContainerProps = {
  alignment: 'left' | 'right';
  alignmentOffset: number;
  top: number;
  ref?: Ref<HTMLDivElement>;
  maxHeight?: number;
  threadId: number;
  isActive: boolean;
  forceWidth?: number;
  transition?: boolean;
};

export const MeasureContainer = (props: ParentProps<MeasureContainerProps>) => {
  let innerRef!: HTMLDivElement;

  const { documentId, setActiveThread, setThreadHeight } =
    useContext(CommentsContext);

  const setDomRect = (threadId: number, rect: DOMRect) => {
    if (rect.height === 0) return;
    setThreadHeight(threadId, rect.height);
  };

  // for some reason some elements dont re-render when height is updated with layout effect
  createEffect(() => {
    const bounds = innerRef.getBoundingClientRect();
    if (bounds) {
      setDomRect(props.threadId, bounds);
    }
  });

  const observer = createMemo(
    () =>
      new ResizeObserver((entries) => {
        const first = entries.at(0);
        if (!first) return;
        setDomRect(props.threadId, first.contentRect);
      })
  );

  createEffect(() => {
    observer().observe(innerRef);
    onCleanup(() => {
      observer().disconnect();
    });
  });

  return (
    <div
      // TODO: make sure the clicks operate correctly
      id={threadMeasureContainerId(documentId, props.threadId)}
      onClick={(e) => {
        setActiveThread(props.threadId);
        e.stopPropagation();
      }}
      style={{
        ...(props.alignment === 'left'
          ? { left: `${props.alignmentOffset}px` }
          : { right: `${props.alignmentOffset}px` }),
        top: `${props.top}px`,
        'max-height': props.maxHeight ? `${props.maxHeight}px` : undefined,
        'min-width': props.forceWidth ? `${props.forceWidth}px` : undefined,
        'z-index': stackingContext.zPlaceable + (props.isActive ? 1 : 0),
      }}
      class="absolute w-full"
      ref={(el) => {
        // console.log('measure container ref', el, props.ref);
        if (typeof props.ref === 'function') {
          props.ref(el);
        } else if (props.ref) {
          props.ref = el;
        }
        innerRef = el;
      }}
      classList={{
        'transition-position duration-50': props.transition,
      }}
    >
      {props.children}
    </div>
  );
};
