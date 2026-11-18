import { useContext } from 'solid-js';
import type { SetStoreFunction, Store } from 'solid-js/store';
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';
import { createLexicalDraggableBlockHost } from '../../editing/overlay-hosts/lexical-draggable-block';
import type { DraggableBlockState } from '../../plugins/draggable-block/draggableBlockPlugin';
import { HostedDraggableBlockMenu } from './HostedDraggableBlockMenu';

export function DraggableBlockMenu(props: {
  state: Store<DraggableBlockState>;
  setState: SetStoreFunction<DraggableBlockState>;
  active: boolean;
}) {
  const lexicalWrapper = useContext(LexicalWrapperContext);
  const host = createLexicalDraggableBlockHost(
    () => lexicalWrapper?.editor,
    (patch) => props.setState(patch)
  );
  return (
    <HostedDraggableBlockMenu
      state={props.state}
      host={host}
      active={props.active}
    />
  );
}
