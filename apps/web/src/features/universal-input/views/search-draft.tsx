import type { EntityData, SearchLocation } from '@entity';
import { type Accessor, createMemo } from 'solid-js';
import { EmbeddedSearch } from '../../next-soup/embedded-search';
import type { InputDisplay } from '../context/capabilities';
import { resolveSearchFilters } from '../core/search';
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
  const filters = createMemo(() =>
    resolveSearchFilters(
      props.state.fields().searchFilters,
      props.actions.people(),
      props.actions.searchChannels(),
      props.actions.inboxes()
    )
  );
  return (
    <EmbeddedSearch
      query={props.state.fields().query}
      onQueryChange={(query) => {
        if (query !== props.state.fields().query)
          props.state.edit('query', query);
      }}
      filters={filters().state}
      onFiltersChange={(next) =>
        props.state.edit('searchFilters', JSON.stringify(next))
      }
      enabled={!props.state.pending() && filters().unresolved.length === 0}
      scopeId={props.scopeId}
      canHandleKeyboard={props.canHandleKeyboard}
      onOpen={props.onOpen}
    />
  );
}
