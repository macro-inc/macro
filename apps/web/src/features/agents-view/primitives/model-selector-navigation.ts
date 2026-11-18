import type { CatalogModelOption } from '@core/component/AI/component/input/modelCatalog';
import { type Accessor, batch, createEffect } from 'solid-js';
import { createStore } from 'solid-js/store';
import { initiallyExpandedProviders } from '../core/model-selection';

export type ModelSelectorPage = 'list' | 'model' | 'effort' | 'speed';

/** Both presentations reset navigation and folds only on dismissal. */
export function createModelSelectorNavigation(
  onOpenChange?: (open: boolean) => void,
  selection?: {
    models: Accessor<CatalogModelOption[]>;
    model: Accessor<string | undefined>;
  }
) {
  const [state, setState] = createStore({
    open: false,
    query: '',
    page: 'list' as ModelSelectorPage,
    expandedProviders: [] as string[],
    initialExpansionPending: false,
    toggledProviders: [] as string[],
  });
  // Finish the opening selection once late discovery arrives, without undoing user folds.
  createEffect(() => {
    if (!state.open || !state.initialExpansionPending || !selection) return;
    const model = selection.model();
    const models = selection.models();
    if (!model || !models.some((option) => option.id === model)) return;
    const initial = initiallyExpandedProviders(models, model).filter(
      (label) => !state.toggledProviders.includes(label)
    );
    batch(() => {
      setState('initialExpansionPending', false);
      setState('expandedProviders', (labels) => [
        ...new Set([...labels, ...initial]),
      ]);
    });
  });
  const changeOpen = (open: boolean) => {
    if (open) {
      setState({
        open,
        initialExpansionPending: Boolean(
          selection &&
            !selection
              .models()
              .some((option) => option.id === selection.model())
        ),
        toggledProviders: [],
        expandedProviders: selection
          ? initiallyExpandedProviders(selection.models(), selection.model())
          : [],
      });
    } else {
      setState({
        open,
        query: '',
        page: 'list',
        expandedProviders: [],
        initialExpansionPending: false,
        toggledProviders: [],
      });
    }
    onOpenChange?.(open);
  };
  const toggleProvider = (label: string) => {
    setState('toggledProviders', (labels) =>
      labels.includes(label) ? labels : [...labels, label]
    );
    setState('expandedProviders', (labels) =>
      labels.includes(label)
        ? labels.filter((entry) => entry !== label)
        : [...labels, label]
    );
  };
  return {
    open: () => state.open,
    query: () => state.query,
    page: () => state.page,
    expanded: (label: string) => state.expandedProviders.includes(label),
    toggleProvider,
    setQuery: (query: string) => setState('query', query),
    setPage: (page: ModelSelectorPage) => setState('page', page),
    changeOpen,
    back: () => setState({ page: 'list', query: '' }),
  };
}
