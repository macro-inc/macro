import { type Location, useLocation, useNavigate } from '@solidjs/router';
export interface RedirectLocation {
  originalLocation: Location;
}

import { useIsAuthenticated } from '@core/auth';
import { createEffect } from 'solid-js';

function useGotoLogin() {
  const navigate = useNavigate();
  const location = useLocation<RedirectLocation>();

  return () => {
    navigate(`/login${location.search}`, {
      state: {
        originalLocation: {
          state: location.state,
          pathname: location.pathname,
          search: location.search,
          hash: location.hash,
        },
      },
    });
  };
}

function _useAuthRedirect() {
  const isAuthenticated = useIsAuthenticated();
  const gotoLogin = useGotoLogin();

  createEffect(() => {
    // undefined means it is still loading
    if (isAuthenticated() === false) {
      gotoLogin();
    }
  });
}
