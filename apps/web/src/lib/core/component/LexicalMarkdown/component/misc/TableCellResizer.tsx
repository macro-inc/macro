import { useContext } from 'solid-js';
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';
import { createLexicalTableResizeHost } from '../../editing/overlay-hosts/lexical-table-resize';
import { TableCellResizerView } from './TableCellResizerView';

export { tableColumnResizeEdge } from './TableCellResizerView';

/** Source table resize handles over the surrounding Lexical editor. */
export function TableCellResizer() {
  const lexicalWrapper = useContext(LexicalWrapperContext);
  const editor = () => lexicalWrapper?.editor;

  return <TableCellResizerView host={createLexicalTableResizeHost(editor)} />;
}
