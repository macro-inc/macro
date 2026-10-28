import type { Component } from 'solid-js';
import { FormMobileSignup } from '../components/forms/FormMobileSignup';
import { MobileSignupMark } from '../components/graphics/MobileSignupMark';
import { setPageSeo } from '../utils/utilSeo';
import './RouteMobileSignup.css';

/**
 * Email capture for phones, the destination of every phone signup link. It is
 * only the capture: the visitor leaves an email and is sent a link to finish
 * onboarding on desktop.
 */
export const RouteMobileSignup: Component = () => {
  setPageSeo({
    title: 'Start for free — Macro',
    description:
      'Enter your email and we will send you a link to set up Macro on your computer.',
    path: '/mobile-signup',
    // A step inside the signup flow: useful to visitors, not a search result.
    noindex: true,
  });

  return (
    <section class="mobile-signup-card">
      <MobileSignupMark />
      <h1 class="mobile-signup-card-title">One app for all your work.</h1>
      <p class="mobile-signup-card-subtitle">
        Macro is better on desktop. Drop your email and we&rsquo;ll send you a
        link to start.
      </p>
      <div class="mobile-signup-card-body">
        <FormMobileSignup buttonName="mobile_signup_page" variant="card" />
      </div>
    </section>
  );
};
