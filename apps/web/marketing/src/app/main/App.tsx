import { Route, Router, useLocation } from '@solidjs/router';
import type { Component, ParentComponent } from 'solid-js';
import {
  createEffect,
  createSignal,
  lazy,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { FeatureDock } from '../../features/marketing/components/FeatureDock';
import { PageVignette } from '../../features/marketing/components/PageVignette';
import {
  FEATURE_PAGES,
  journeyHref,
} from '../../features/marketing/core/navigation';
import {
  applyTheme,
  systemThemeEffect,
} from '../../lib/theme/utils/themeUtils';
import { BaseHeader } from '../components/base/BaseHeader';
import { DialogTheme } from '../components/dialogs/DialogTheme';
import { UtilWrap } from '../components/utils/UtilWrap';
import { analytics } from '../utils/utilAnalytic';

import { utilFaviconEffect } from '../utils/utilFavicon';
import {
  MOBILE_SIGNUP_PATH,
  MOBILE_SIGNUP_SENT_PATH,
} from '../utils/utilMobileSignup';

function JourneyEntry() {
  onMount(() => {
    window.location.replace('/start');
  });
  return null;
}

const RouteJobs = lazy(() =>
  import('../routes/RouteJobs').then((module) => ({
    default: module.RouteJobs,
  }))
);
const RouteTerms = lazy(() =>
  import('../routes/RouteTerms').then((module) => ({
    default: module.RouteTerms,
  }))
);
const RoutePrivacy = lazy(() =>
  import('../routes/RoutePrivacy').then((module) => ({
    default: module.RoutePrivacy,
  }))
);
const RouteDpa = lazy(() =>
  import('../routes/RouteDpa').then((module) => ({ default: module.RouteDpa }))
);
const RouteTest = lazy(() =>
  import('../routes/RouteTest').then((module) => ({
    default: module.RouteTest,
  }))
);
const PostsIndex = lazy(() => import('../../routes/posts/index'));
const PostPage = lazy(() => import('../../routes/posts/PostPage'));
const RouteStartups = lazy(() =>
  import('../routes/RouteStartups').then((module) => ({
    default: module.RouteStartups,
  }))
);
const RouteTasks = lazy(() =>
  import('../routes/RouteTasks').then((module) => ({
    default: module.RouteTasks,
  }))
);
const RouteEmail = lazy(() =>
  import('../routes/RouteEmail').then((module) => ({
    default: module.RouteEmail,
  }))
);
const RouteDocuments = lazy(() =>
  import('../routes/RouteDocuments').then((module) => ({
    default: module.RouteDocuments,
  }))
);
const RouteChannels = lazy(() =>
  import('../routes/RouteChannels').then((module) => ({
    default: module.RouteChannels,
  }))
);
const RouteCalls = lazy(() =>
  import('../routes/RouteCalls').then((module) => ({
    default: module.RouteCalls,
  }))
);
const RouteCrm = lazy(() =>
  import('../routes/RouteCrm').then((module) => ({ default: module.RouteCrm }))
);
const RouteAgents = lazy(() =>
  import('../routes/RouteAgents').then((module) => ({
    default: module.RouteAgents,
  }))
);
const RouteGithub = lazy(() =>
  import('../routes/RouteGithub').then((module) => ({
    default: module.RouteGithub,
  }))
);
const RoutePricing = lazy(() =>
  import('../routes/RoutePricing').then((module) => ({
    default: module.RoutePricing,
  }))
);
const RoutePartners = lazy(() =>
  import('../routes/RoutePartners').then((module) => ({
    default: module.RoutePartners,
  }))
);
const RoutePartnerTerms = lazy(() =>
  import('../routes/RoutePartnerTerms').then((module) => ({
    default: module.RoutePartnerTerms,
  }))
);
const RouteMigrate = lazy(() =>
  import('../routes/RouteMigrate').then((module) => ({
    default: module.RouteMigrate,
  }))
);
const RouteMobileSignup = lazy(() =>
  import('../routes/RouteMobileSignup').then((module) => ({
    default: module.RouteMobileSignup,
  }))
);
const RouteMobileSignupSent = lazy(() =>
  import('../routes/RouteMobileSignupSent').then((module) => ({
    default: module.RouteMobileSignupSent,
  }))
);

/*
macro is
mold to your business
maybe self host
mcp docs

imagen if the product was a dev tool.
agentic hivemind for yourn business

the iphone of tokens
macbook of protons
*/

const RootLayout: ParentComponent = (props) => {
  const location = useLocation();
  let scrollRef!: HTMLDivElement;
  const [headerCtaActive, setHeaderCtaActive] = createSignal(false);

  // Lets the shared CTA handler navigate client-side (mobile email capture is
  // a site route now), which it can't do on its own outside the Router.

  createEffect(
    on(
      () => location.pathname,
      (path) => {
        analytics.pageView(path);
      },
      { defer: true } // Skip initial run - GA4/Meta Pixel track initial pageview on init
    )
  );

  createEffect(
    on(
      () => location.pathname,
      () => {
        requestAnimationFrame(() => {
          scrollRef?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
        });
      },
      { defer: true }
    )
  );

  onMount(() => {
    const handleScroll = () => {
      setHeaderCtaActive(
        scrollRef.scrollTop >= HEADER_CTA_ACTIVE_SCROLL_THRESHOLD
      );
    };

    handleScroll();
    scrollRef.addEventListener('scroll', handleScroll, { passive: true });
    onCleanup(() => scrollRef.removeEventListener('scroll', handleScroll));
  });

  return (
    <>
      <div
        id="app-scroll-root"
        ref={scrollRef}
        style={{
          'overscroll-behavior': 'none',
          'box-sizing': 'border-box',
          'scrollbar-width': 'none',
          'justify-items': 'center',
          'overflow-y': 'scroll',
          'overflow-x': 'hidden',
          // Viewport units are NOT scaled by the html `zoom` (--site-scale), so
          // 100vw would render 10% wider than the screen and shove the centered
          // grid content off to the right. Divide by the zoom to land exactly
          // on the real viewport.
          height: 'calc(100dvh / var(--site-scale, 1))',
          display: 'grid',
          width: 'calc(100vw / var(--site-scale, 1))',
        }}
      >
        <BaseHeader ctaActive={headerCtaActive()} />
        <UtilWrap>{props.children}</UtilWrap>
      </div>
      <PageVignette />
      <Show
        when={FEATURE_PAGES.some((page) => page.href === location.pathname)}
      >
        <FeatureDock
          features={FEATURE_PAGES}
          active={FEATURE_PAGES.findIndex(
            (page) => page.href === location.pathname
          )}
          continueHref={journeyHref()}
          continueLabel="Get started"
        />
      </Show>
      <DialogTheme />
    </>
  );
};

const HEADER_CTA_ACTIVE_SCROLL_THRESHOLD = 250;

export const App: Component<{
  /** Request path for build-time prerendering (ignored in the browser). */ url?: string;
}> = (props) => {
  // The animal clock now starts itself while animate() subscribers exist —
  // no unconditional global rAF loop.
  systemThemeEffect();
  applyTheme('Macro');
  utilFaviconEffect();

  return (
    <Router root={RootLayout} url={props.url}>
      <Route path="/" component={JourneyEntry} />
      <Route path="/jobs" component={RouteJobs} />
      <Route path="/terms" component={RouteTerms} />
      <Route path="/privacy" component={RoutePrivacy} />
      <Route path="/dpa" component={RouteDpa} />
      <Route path="/posts" component={PostsIndex} />
      <Route path="/posts/:slug" component={PostPage} />
      <Route path="/startups" component={RouteStartups} />
      <Route path="/tasks" component={RouteTasks} />
      <Route path="/email" component={RouteEmail} />
      <Route path="/documents" component={RouteDocuments} />
      <Route path="/channels" component={RouteChannels} />
      <Route path="/calls" component={RouteCalls} />
      <Route path="/crm" component={RouteCrm} />
      <Route path="/agents" component={RouteAgents} />
      <Route path="/github" component={RouteGithub} />
      <Route path="/pricing" component={RoutePricing} />
      {/* Partner program: the landing page and its full program terms. */}
      <Route path="/partners" component={RoutePartners} />
      <Route path="/partners/terms" component={RoutePartnerTerms} />
      {/* Mobile-web signup: email capture and its "check your email"
          confirmation. Mobile CTAs land here instead of loading the app just to
          show an email field. */}
      <Route path={MOBILE_SIGNUP_PATH} component={RouteMobileSignup} />
      <Route path={MOBILE_SIGNUP_SENT_PATH} component={RouteMobileSignupSent} />
      {/* The switching guide. Prerendered and in the sitemap; reached from the
          versus posts and the footer rather than the header nav. */}
      <Route path="/migrate" component={RouteMigrate} />
      <Route path="/test" component={RouteTest} />
    </Router>
  );
};
