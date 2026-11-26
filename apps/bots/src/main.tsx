import { A, Route, Router, useLocation } from '@solidjs/router';
import {
  createResource,
  ErrorBoundary,
  lazy,
  type ParentProps,
  Show,
} from 'solid-js';
import { render } from 'solid-js/web';
import mark from './assets/mark.svg';
import wordmark from './assets/wordmark.svg';
import { buildSignInUrl, editIntent, fleetIntent } from './return-intent';
import { towerViews } from './routes';
import { session } from './session';
import './style.css';

const Creator = lazy(() => import('./creator'));
const Brain = lazy(() => import('./brain'));
const SignIn = lazy(() => import('./sign-in'));
const Fleet = lazy(() => import('./fleet'));
const Passwords = __BOTS_FIXTURES__
  ? lazy(() => import('./passwords/view'))
  : () => <TowerUnavailable heading={towerViews.passwords} />;
const Billing = lazy(() => import('./billing'));

function Shell(props: ParentProps) {
  const location = useLocation();
  const [identity] = createResource(() => session.getSession());

  return (
    <>
      <header class="top">
        <A href="/" class="brand" aria-label="Macro Bots Creator">
          <img src={mark} alt="" />
          <img src={wordmark} alt="" />
        </A>
        <Show when={__BOTS_FIXTURES__}>
          <span class="fixture">Local fixture</span>
        </Show>
        <nav aria-label="Main">
          <A href="/" end>
            Creator
          </A>
          <A href="/fleet" end>
            {towerViews.fleet}
          </A>
          <Show
            when={location.pathname !== '/' && location.pathname !== '/sign-in'}
          >
            <A href="/passwords" end>
              {towerViews.passwords}
            </A>
            <A href="/billing" end>
              {towerViews.billing}
            </A>
          </Show>
          <Show
            when={
              identity()?.status === 'signed-out' &&
              location.pathname !== '/sign-in'
            }
          >
            <A
              href={buildSignInUrl(
                location.pathname === '/fleet' ? fleetIntent : editIntent
              )}
            >
              Sign in with Macro
            </A>
          </Show>
        </nav>
      </header>
      <main data-route={location.pathname}>
        <ErrorBoundary fallback={<p role="alert">This view is unavailable.</p>}>
          {props.children}
        </ErrorBoundary>
      </main>
      <footer>
        Portraits derived from Lee Perry-Smith, Infinite-Realities · CC BY 3.0
      </footer>
    </>
  );
}

function TowerUnavailable(props: { heading: string }) {
  return (
    <section class="panel sign-in">
      <h1>{props.heading}</h1>
      <p>This section is unavailable in the foundation preview.</p>
      <A href="/fleet">Back to Fleet</A>
    </section>
  );
}

const root = document.getElementById('root');

if (root) {
  render(
    () => (
      <Router root={Shell}>
        <Route path="/" component={Creator} />
        <Route path="/fleet" component={Fleet} />
        <Route path="/sign-in" component={SignIn} />
        <Route path="/teams/:team/bots/:bot/:view/:entry?" component={Brain} />
        <Route path="/passwords" component={Passwords} />
        <Route path="/billing" component={Billing} />
        <Route
          path="*"
          component={() => (
            <p class="notice">
              This view is unavailable. <A href="/fleet">Back to Fleet</A>
            </p>
          )}
        />
      </Router>
    ),
    root
  );
}
