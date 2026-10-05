import { Telemetry } from '@macro-inc/observability';
import { createSignal } from 'solid-js';
import type { ViewCreation } from '../core/view-creation';
import type { DatabaseOpFailure } from '../core/write-failure';

/** Local views survive detail refetches while their create is pending or retryable. */
export function createViewCreation() {
  const [drafts, setDrafts] = createSignal<
    (ViewCreation & { pending: boolean; failure?: DatabaseOpFailure })[]
  >([]);
  const discard = (id: string) =>
    setDrafts((items) => items.filter((item) => item.view.id !== id));
  const save = async (creation: ViewCreation) => {
    setDrafts((items) =>
      items.map((item) =>
        item.view.id === creation.view.id
          ? { ...item, pending: true, failure: undefined }
          : item
      )
    );
    const span = Telemetry.span('database.view.create');
    const result = await span.run(() => creation.save());
    span.setAttr('database.outcome', result.isOk() ? 'success' : 'error');
    span.end();
    result.match(
      () => discard(creation.view.id),
      (failure) =>
        setDrafts((items) =>
          items.map((item) =>
            item.view.id === creation.view.id
              ? { ...item, pending: false, failure }
              : item
          )
        )
    );
  };
  return {
    drafts,
    discard,
    start: (creation: ViewCreation) => {
      setDrafts((items) => [...items, { ...creation, pending: true }]);
      void save(creation);
    },
    retry: (id: string) => {
      const creation = drafts().find((item) => item.view.id === id);
      if (creation && !creation.pending) void save(creation);
    },
  };
}
