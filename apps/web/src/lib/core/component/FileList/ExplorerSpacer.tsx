import CaretRight from '@phosphor/caret-right.svg';
import { cn } from '@ui';
import { createMemo, Index } from 'solid-js';
import {
  FILE_LIST_CARET_WIDTH,
  FILE_LIST_ROW_HEIGHT,
  FILE_LIST_SPACER_WIDTH,
  type FileListSize,
} from './constants';

function FileLevelSpacer(props: { size: FileListSize }) {
  return (
    <div
      class={cn(
        'file-level-spacer',
        FILE_LIST_SPACER_WIDTH[props.size],
        FILE_LIST_ROW_HEIGHT[props.size],
        'border-r border-edge'
      )}
    />
  );
}

function _CaretSpacer(props: { size: FileListSize }) {
  return (
    <div
      class={cn('caret-spacer min-h-full', FILE_LIST_CARET_WIDTH[props.size])}
    />
  );
}

function _Caret(props: { isExpanded: boolean; size: FileListSize }) {
  return (
    <div
      class={cn(
        'expand-project-caret flex items-center justify-center',
        FILE_LIST_CARET_WIDTH[props.size],
        'transition-transform duration-150',
        props.isExpanded && 'rotate-90'
      )}
    >
      <CaretRight class={`size-3`} />
    </div>
  );
}

type ExplorerSpacerProps = {
  depth?: number;
  size?: FileListSize;
};

export function ExplorerSpacer(props: ExplorerSpacerProps) {
  if (props.depth === undefined) {
    return '';
  }
  const depth = createMemo(() => new Array(props.depth).fill(null));

  return (
    <Index each={depth()}>
      {() => <FileLevelSpacer size={props.size ?? 'sm'} />}
    </Index>
  );
}
