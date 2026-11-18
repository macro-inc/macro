import { useContext } from 'solid-js';
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';
import { createLexicalTableMoveHost } from '../../editing/overlay-hosts/lexical-table-move';
import { TableMoveHandleView } from './TableMoveHandleView';

/** Source table move handle over the surrounding Lexical editor. */
export function TableMoveHandle() {
  const lexicalWrapper = useContext(LexicalWrapperContext);
  const editor = () => lexicalWrapper?.editor;
  const host = createLexicalTableMoveHost(editor);

  return <TableMoveHandleView host={host} />;
}
