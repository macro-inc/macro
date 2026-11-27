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
import terrain from './assets/terrain.svg?raw';
import wordmark from './assets/wordmark.svg';
import {
  billingIntent,
  buildSignInUrl,
  editIntent,
  fleetIntent,
  passwordsIntent,
} from './return-intent';
import { towerViews } from './routes';
import { session } from './session';
import './style.css';
import './motion.css';

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

  const intent = () => {
    if (location.pathname === '/passwords') return passwordsIntent;
    if (location.pathname === '/billing') return billingIntent;
    if (location.pathname === '/fleet') return fleetIntent;
    return editIntent;
  };

  return (
    <>
      <div class="terrain" aria-hidden="true" innerHTML={terrain} />
      <header class="top">
        <A href="/" class="brand" aria-label="Macro Bots Creator">
          <img src={mark} alt="" />
          <img src={wordmark} alt="" />
        </A>
        <Show when={__BOTS_FIXTURES__}>
          <span class="fixture">Sample data</span>
        </Show>
        <nav aria-label="Main">
          <A href="/" end>
            Creator
          </A>
          <A href="/fleet" end>
            {towerViews.fleet}
          </A>
          <A href="/passwords" end>
            {towerViews.passwords}
          </A>
          <A href="/billing" end>
            {towerViews.billing}
          </A>
        </nav>
        <div class="top-identity">
          <Show
            when={
              identity()?.status === 'signed-out' &&
              location.pathname !== '/sign-in'
            }
          >
            <A href={buildSignInUrl(intent())}>Sign in with Macro</A>
          </Show>
          <Show
            when={
              location.pathname === '/sign-in' ||
              identity()?.status === 'signed-in'
            }
          >
            <span>
              {location.pathname === '/sign-in' ? 'Sign-in' : 'Signed in'}
            </span>
          </Show>
        </div>
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
