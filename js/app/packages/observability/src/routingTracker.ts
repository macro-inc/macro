import { datadogRum } from '@datadog/browser-rum';
import { useLocation } from '@solidjs/router';
import { createEffect, createMemo, on } from 'solid-js';
import { isInitialized } from './shared';

export function useObserveRouting() {
  const location = useLocation();
  const pathSegments = createMemo(() =>
    location.pathname
      .split('/')
      .filter((segment) => !!segment && segment !== 'app')
  );
  const viewName = () =>
    pathSegments().at(0) === 'component'
      ? pathSegments().at(1)
      : pathSegments().at(0);
  createEffect(
    on(viewName, (name, prevName) => {
      if (!isInitialized() || !name) return;

      if (name !== prevName) {
        datadogRum.startView({
          name,
          context: {
            pathname: location.pathname,
            search: location.search,
            hash: location.hash,
          },
        });
      }

      return name;
    })
  );

  const joinedPath = createMemo(() => pathSegments().join('/'));
  createEffect((prevSplits) => {
    const splits = joinedPath();

    if (!isInitialized()) return;
    if (splits !== prevSplits) {
      datadogRum.addAction('split changed', {
        from: prevSplits,
        to: splits,
      });
    }

    return splits;
  });
}
