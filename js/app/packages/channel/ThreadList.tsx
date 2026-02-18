import { type Accessor, type JSX, createSignal } from 'solid-js';
import { match, P } from 'ts-pattern';
import { type VirtualizerHandle, VList } from 'virtua/solid';

type ThreadListPosition =
  | {
      tag: 'start';
    }
  | {
      tag: 'end';
    }
  | {
      tag: 'index';
      index: number;
    };

type ThreadListProps<T extends { id: string }> = {
  data: Accessor<T[]>;
  children: (item: T) => JSX.Element;
  initialListPosition: ThreadListPosition;
  onScrollNearTop?: () => void;
  isPrepending?: Accessor<boolean>;
};

const NEAR_TOP_THRESHOLD = 100;
const NEAR_BOTTOM_THRESHOLD = 1.5;

function scrollToPosition(
  virtualHandle: VirtualizerHandle,
  position: ThreadListPosition,
  itemCount: number
) {
  match(position)
    .with({ tag: 'start' }, () => {
      virtualHandle.scrollToIndex(0, {
        align: 'start',
      });
    })
    .with({ tag: 'end' }, () => {
      virtualHandle.scrollToIndex(itemCount, {
        align: 'end',
      });
    })

    .with({ tag: 'index', index: P.select() }, (index) => {
      virtualHandle.scrollToIndex(index, {
        align: 'nearest',
      });
    })
    .exhaustive();
}

export function ThreadList<T extends { id: string }>(
  props: ThreadListProps<T>
) {
  const [virtualHandle, setVirtualHandle] = createSignal<VirtualizerHandle>();
  const [isNearTop, setIsNearTop] = createSignal(false);

  const handleScroll = () => {
    const handle = virtualHandle();
    if (!handle) return;

    const nearTop = handle.scrollOffset <= NEAR_TOP_THRESHOLD;
    const nearBottom =
      handle.scrollSize - handle.viewportSize - handle.scrollOffset <=
      NEAR_BOTTOM_THRESHOLD;

    if (nearTop && !nearBottom && !isNearTop()) {
      props.onScrollNearTop?.();
    }

    setIsNearTop(nearTop);
  };

  return (
    <VList
      ref={(ref) => {
        if (!ref) return;
        setVirtualHandle(ref);
        scrollToPosition(
          ref,
          props.initialListPosition,
          props.data().length - 1
        );
      }}
      data={props.data()}
      onScroll={handleScroll}
      shift={props.isPrepending ? props.isPrepending() : false}
      style={{
        'overflow-anchor': 'none',
        display: 'flex',
      }}
    >
      {(item) => props.children(item)}
    </VList>
  );
}
