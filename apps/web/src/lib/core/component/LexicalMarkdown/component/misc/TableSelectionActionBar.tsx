import { useContext } from 'solid-js';
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';
import { createLexicalTableSelectionActionsHost } from '../../editing/overlay-hosts/lexical-table-selection-actions';
import { TableSelectionActionBarView } from './TableSelectionActionBarView';

/** Source touch table selection action bar over the surrounding Lexical editor. */
export function TableSelectionActionBar() {
  const lexicalWrapper = useContext(LexicalWrapperContext);
  const editor = () => lexicalWrapper?.editor;
  const host = createLexicalTableSelectionActionsHost(editor);

  return <TableSelectionActionBarView host={host} />;
}
