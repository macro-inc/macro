import '@fontsource-variable/inter';
import '../index.css';
import {
  BookingPage,
  BookingReceiptPage,
} from '@app/features/scheduling/public-booking';
import { ROUTER_BASE } from '@app/lib/constants/routerBase';
import { queryClient } from '@queries/client';
import { Route, Router, useParams } from '@solidjs/router';
import { QueryClientProvider } from '@tanstack/solid-query';
import {
  applyTheme,
  ensureMinimalThemeContrast,
  resolveActiveThemeId,
  systemThemeEffect,
} from '@theme/utils/themeUtils';
import type { ParentProps } from 'solid-js';
import { render } from 'solid-js/web';

/** A scrolling page on the page background, like the app's focused pages. */
function Page(props: ParentProps) {
  systemThemeEffect();
  return (
    <div class="min-h-0 flex-1 overflow-y-auto bg-page text-ink">
      {props.children}
    </div>
  );
}

function BookingRoute() {
  const params = useParams<{ profile: string; slug?: string }>();
  return <BookingPage profile={params.profile} slug={params.slug} />;
}

function ReceiptRoute() {
  const params = useParams<{ id: string }>();
  return <BookingReceiptPage id={params.id} />;
}

applyTheme(resolveActiveThemeId());
ensureMinimalThemeContrast();

const root = document.getElementById('root');
if (root)
  render(
    () => (
      <QueryClientProvider client={queryClient}>
        <Router base={ROUTER_BASE} root={Page}>
          <Route path="/book/:profile/:slug?" component={BookingRoute} />
          <Route path="/booking/:id" component={ReceiptRoute} />
        </Router>
      </QueryClientProvider>
    ),
    root
  );
