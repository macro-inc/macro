import {
  AccountManagerRequestNode,
  AgentContextNode,
  AwaitNode,
  CursorSystemNotificationNode,
  DocumentCardNode,
  ReplyTargetNode,
  WatermarkNode,
} from '@macro-inc/lexical-core';
import { setDecorator } from '@macro-inc/lexical-core/decoratorRegistry';
import {
  type EditorView,
  registerMacroDecoratorViews,
} from '@macro-inc/lexical-wasm-view';
import { Await } from '../../component/decorator/Await';
import type { DocumentCardProps } from '../../component/decorator/DocumentCard';
import { createNativeFastStaticDecoratorViews } from '../../decorator-host/fast-static-views';
import { createNativeDocumentCardContext } from '../../decorator-host/native-document-card-host';
import { createNativeDocumentCardViews } from '../../decorator-host/native-document-card-views';
import { createNativeSelectionDecoratorContext } from '../../decorator-host/native-selection-host';

/** Real native projectors and Await UI; record card props without fetching its preview. */
export function registerDatabaseFixtureComponents() {
  for (const klass of [
    AccountManagerRequestNode,
    AgentContextNode,
    CursorSystemNotificationNode,
    ReplyTargetNode,
    WatermarkNode,
  ])
    setDecorator(klass, () => null);
  setDecorator(AwaitNode, Await);
  setDecorator<DocumentCardProps>(DocumentCardNode, (props) => (
    <span data-fixture-database-card={props.documentId}>
      {props.documentName}
    </span>
  ));
}

export function installDatabaseFixtureViews(view: EditorView) {
  registerDatabaseFixtureComponents();
  const selection = createNativeSelectionDecoratorContext({});
  const card = createNativeDocumentCardContext(
    {},
    { isInteractable: () => view.isEditable, skipPreviewFetch: true }
  );
  registerMacroDecoratorViews(view.registry, {
    ...createNativeFastStaticDecoratorViews(selection),
    ...createNativeDocumentCardViews(card),
  });
  return () => {
    card.dispose();
    selection.dispose();
  };
}
