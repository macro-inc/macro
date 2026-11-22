import { DatabaseCardSkeleton } from '@app/features/block-database/component/DatabaseCardSkeleton';
import { lazy } from '@core/util/lazy';
import { createSignal, onCleanup, Show, Suspense, useContext } from 'solid-js';
import { LexicalWrapperContext } from '../../context/LexicalWrapperContext';
import { createLexicalDocumentCardHost } from '../../decorator-host/lexical-document-card';
import { LexicalInteractiveBoundary } from '../core/LexicalInteractiveBoundary';
import type { DocumentCardProps } from './DocumentCard';

const DocumentDatabase = lazy(async () => ({
  default: (await import('@app/features/block-database/document-database'))
    .DocumentDatabase,
}));

/** Database cards use their own metadata and editor, never document previews. */
export function DatabaseCard(props: DocumentCardProps) {
  const wrapper = useContext(LexicalWrapperContext);
  const host = props.host ?? createLexicalDocumentCardHost(wrapper);
  const [collapsed, setCollapsed] = createSignal(false);
  const [params, setParams] = createSignal(props.blockParams ?? {});
  let savedParams = props.blockParams;
  const releaseParams = host.observeBlockParams(props.key, (next) => {
    if (next !== savedParams) {
      savedParams = next;
      setParams(next);
    }
  });
  if (releaseParams) onCleanup(releaseParams);
  const changeLocation = (params: Record<string, string>) => {
    setParams(params);
    if (!host.isEditable() || !host.isInteractable()) return;
    host.setBlockParams(props.key, params);
  };
  const toggle = () => {
    if (!host.isEditable() || !host.isInteractable()) {
      setCollapsed(!collapsed());
      return;
    }
    host.convertToMention(props.key, true);
  };
  const placeholder = () => (
    <div class="my-2 rounded-lg border border-edge-muted px-3 py-2 text-sm text-ink-muted">
      {props.documentName || 'Database'}
    </div>
  );
  return (
    <Show when={!host.skipPreviewFetch} fallback={placeholder()}>
      <Suspense
        fallback={
          <DatabaseCardSkeleton name={props.documentName || 'Database'} />
        }
      >
        <LexicalInteractiveBoundary>
          <DocumentDatabase
            databaseId={props.documentId}
            name={props.documentName}
            params={params()}
            collapsed={collapsed()}
            onToggle={toggle}
            onLocationChange={changeLocation}
          />
        </LexicalInteractiveBoundary>
      </Suspense>
    </Show>
  );
}
