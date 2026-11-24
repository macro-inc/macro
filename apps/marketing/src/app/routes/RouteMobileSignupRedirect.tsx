import { type Component, onMount } from 'solid-js';
import { setPageSeo } from '../utils/utilSeo';

/**
 * `/mobile-signup` and `/mobile-signup-sent` once held the phone email
 * capture. Phones now sign up in the app like desktop, so old links (ads,
 * emails, bookmarks) forward there with their query intact for attribution.
 */
export const RouteMobileSignupRedirect: Component = () => {
  setPageSeo({
    title: 'Start for free — Macro',
    description: 'Create your Macro workspace.',
    path: '/mobile-signup',
    noindex: true,
  });
  onMount(() => {
    window.location.replace(`/app/signup${window.location.search}`);
  });
  return null;
};
