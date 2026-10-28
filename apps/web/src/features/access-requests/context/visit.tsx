import { createContext, type ParentProps, useContext } from 'solid-js';
import { createVisitReview } from '../core/visit';

const VisitContext = createContext<{
  key(): string;
  claim(entity: string): boolean;
}>();

export function AccessRequestVisitProvider(
  props: ParentProps<{ visit: string }>
) {
  const visit = createVisitReview();
  return (
    <VisitContext.Provider
      value={{
        key: () => props.visit,
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
