import {
  createContext,
  createMemo,
  type ParentProps,
  useContext,
} from 'solid-js';
import { createVisitReview } from '../core/visit';

const VisitContext = createContext<{
  key(): string;
  /** When the panel arrived at this visit, in epoch milliseconds. */
  startedAt(): number;
  claim(entity: string): boolean;
}>();

export function AccessRequestVisitProvider(
  props: ParentProps<{ visit: string }>
) {
  const visit = createVisitReview();
  const startedAt = createMemo(() => {
    props.visit;
    return Date.now();
  });
  return (
    <VisitContext.Provider
      value={{
        key: () => props.visit,
        startedAt,
        claim(entity) {
          visit.navigate(props.visit);
          return visit.claim(entity);
        },
      }}
    >
      {props.children}
    </VisitContext.Provider>
  );
}

export function useAccessRequestVisit() {
  return useContext(VisitContext);
}
