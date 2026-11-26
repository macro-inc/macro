import type { EntityData, SearchLocation } from '@entity';
import { type Accessor, batch, createMemo } from 'solid-js';
import { searchBindingsIn } from '../../next-soup/core/search-operators';
import { EmbeddedSearch } from '../../next-soup/embedded-search';
import type { InputDisplay } from '../context/capabilities';
import type { UniversalInputController } from '../primitives/universal-input';

export function SearchDraft(props: {
  state: UniversalInputController;
  actions: InputDisplay;
  scopeId: string;
  canHandleKeyboard?: Accessor<boolean>;
  onOpen: (
    entity: EntityData,
    newSplit: boolean,
    location?: SearchLocation
  ) => void;
}) {
  const draft = createMemo(() => props.actions.search(props.state.fields()));
  // Once edited, the field's text is the whole search: the filters it showed
  // stay in it as operators, with the ids their tokens stand for, and later
  // predictions leave it as typed. One batch, so the field never sees the
  // words without the operators in between.
  const edit = (text: string) => {
    if (text === draft().text) return;
    const fields = props.state.fields();
    const bindings = JSON.stringify(searchBindingsIn(text, draft().bindings));
    batch(() => {
      if (fields.searchFilters) props.state.edit('searchFilters', '');
      if (bindings !== (fields.searchBindings || '[]'))
        props.state.edit('searchBindings', bindings);
      props.state.edit('query', text);
    });
  };
  return (
    <EmbeddedSearch
      query={draft().text}
      bindings={draft().bindings}
      onQueryChange={edit}
      enabled={!props.state.pending() && draft().unresolved.length === 0}
      scopeId={props.scopeId}
      canHandleKeyboard={props.canHandleKeyboard}
      onOpen={props.onOpen}
    />
  );
}
