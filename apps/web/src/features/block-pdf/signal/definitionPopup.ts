import { usePdfDocument } from '../context/pdf-document-context';
import type { DefinitionPopupAction } from '../primitives/pdf-definitions';

export function usePopupContextUpdate(
  isPopup: boolean
): (action: DefinitionPopupAction) => void {
  const commands = usePdfDocument().definitions.commands;
  return isPopup ? commands.dispatchPopup : commands.dispatchRoot;
}

export function usePopupStore(isPopup: boolean) {
  const definitions = usePdfDocument().definitions;
  return isPopup ? definitions.popup : definitions.root;
}
