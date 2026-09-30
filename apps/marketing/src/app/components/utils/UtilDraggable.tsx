import {
  createContext,
  createSignal,
  type JSX,
  type ParentProps,
  useContext,
} from 'solid-js';

interface DraggableContextValue {
  isDragging: () => boolean;
  handlePointerDown: (e: PointerEvent) => void;
  handlePointerMove: (e: PointerEvent) => void;
  handlePointerUp: (e: PointerEvent) => void;
}

interface DraggableProps extends ParentProps {
  position?: 'absolute' | 'fixed';
  style?: JSX.CSSProperties;
  initialX?: number;
  initialY?: number;
  display?: boolean;
  id?: string;
}

interface DragHandleProps extends ParentProps {
  style?: JSX.CSSProperties;
}

const DraggableContext = createContext<DraggableContextValue>();

function getPositionedAncestor(element: HTMLElement): HTMLElement | null {
  let parent = element.parentElement;
  while (parent) {
    const position = getComputedStyle(parent).position;
    if (
      position === 'relative' ||
      position === 'absolute' ||
      position === 'fixed' ||
      position === 'sticky'
    ) {
      return parent;
    }
    parent = parent.parentElement;
  }
  return null;
}

export function DragHandle(props: DragHandleProps) {
  const context = useContext(DraggableContext);

  if (!context) {
    console.warn('DragHandle must be used within a Draggable component');
    return <>{props.children}</>;
  }

  return (
    <div
      onPointerDown={context.handlePointerDown}
      onPointerMove={context.handlePointerMove}
      onPointerUp={context.handlePointerUp}
      style={{
        cursor: context.isDragging() ? 'grabbing' : 'grab',
        'touch-action': 'none',
        'user-select': 'none',
        ...props.style,
      }}
    >
      {props.children}
    </div>
  );
}

export function Draggable(props: DraggableProps) {
  const [boxPosition, setBoxPosition] = createSignal({
    x: props.initialX ?? 0,
    y: props.initialY ?? 0,
  });
  const [isDragging, setIsDragging] = createSignal(false);
  const [dragOffset, setDragOffset] = createSignal({ x: 0, y: 0 });

  let elementRef: HTMLDivElement | undefined;
  // Measured once per drag: calling getBoundingClientRect inside pointermove
  // forces a synchronous layout on every event.
  let dragSize = { width: 0, height: 0 };

  const handlePointerDown = (e: PointerEvent) => {
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);

    const rect = elementRef!.getBoundingClientRect();
    dragSize = { width: rect.width, height: rect.height };
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
    setIsDragging(true);
  };

  const handlePointerMove = (e: PointerEvent) => {
    if (!isDragging() || !elementRef) {
      return;
    }

    let newX = e.clientX - dragOffset().x;
    let newY = e.clientY - dragOffset().y;

    if (props.position === 'fixed') {
      const maxX = window.innerWidth - dragSize.width;
      const maxY = window.innerHeight - dragSize.height;

      newX = Math.max(0, Math.min(newX, maxX));
      newY = Math.max(0, Math.min(newY, maxY));
    } else {
      const positionedAncestor = getPositionedAncestor(elementRef);
      if (positionedAncestor) {
        const ancestorRect = positionedAncestor.getBoundingClientRect();
        newX -= ancestorRect.left;
        newY -= ancestorRect.top;
      }
    }

    setBoxPosition({ x: newX, y: newY });
  };

  const handlePointerUp = (e: PointerEvent) => {
    const target = e.currentTarget as HTMLElement;
    target.releasePointerCapture(e.pointerId);
    setIsDragging(false);
  };

  const contextValue: DraggableContextValue = {
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    isDragging,
  };

  return (
    <DraggableContext.Provider value={contextValue}>
      <div
        ref={elementRef}
        id={props.id}
        style={{
          display: props.display === false ? 'none' : undefined,
          position: props.position ?? 'absolute',
          // Drag moves via transform (compositor-only) instead of left/top,
          // which would relayout + repaint on every pointermove.
          left: '0',
          top: '0',
          transform: `translate3d(${boxPosition().x}px, ${boxPosition().y}px, 0)`,
          ...props.style,
          'z-index': 10,
        }}
      >
        {props.children}
      </div>
    </DraggableContext.Provider>
  );
}
