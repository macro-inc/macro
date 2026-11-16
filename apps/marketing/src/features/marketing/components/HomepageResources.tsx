import IconGithub from '../../../assets/icons/icon-github.svg';
import IconInstagram from '../../../assets/icons/icon-instagram.svg';
import IconLinkedin from '../../../assets/icons/icon-linkedin.svg';
import IconTwitter from '../../../assets/icons/icon-twitter.svg';
import './homepage-resources.css';

/** Homepage companion to the feature pages' section outline. */
export function HomepageResources() {
  return (
    <aside class="page-outline homepage-resources" aria-label="Resources">
      <p>Downloads</p>
      <nav aria-label="Downloads">
        <a
          href="https://apps.apple.com/us/app/macro-app/id6743133649"
          target="_blank"
          rel="noreferrer"
        >
          Download for iOS
        </a>
        <a
          href="https://play.google.com/store/apps/details?id=com.macro.workspace.mobile"
          target="_blank"
          rel="noreferrer"
        >
          Download for Android
        </a>
      </nav>
      <p>Links</p>
      <nav class="homepage-social-links" aria-label="Links">
        <a
          aria-label="GitHub"
          title="GitHub"
          href="https://github.com/macro-inc/macro"
          target="_blank"
          rel="noreferrer"
        >
          <IconGithub aria-hidden="true" />
        </a>
        <a
          aria-label="X / Twitter"
          title="X / Twitter"
          href="https://x.com/macrodotcom"
          target="_blank"
          rel="noreferrer"
        >
          <IconTwitter aria-hidden="true" />
        </a>
        <a
          aria-label="LinkedIn"
          title="LinkedIn"
          href="https://www.linkedin.com/company/macrocom"
          target="_blank"
          rel="noreferrer"
        >
          <IconLinkedin aria-hidden="true" />
        </a>
        <a
          aria-label="YouTube"
          title="YouTube"
          href="https://www.youtube.com/channel/UCcn-1WTGff0X_RscGVtwljQ"
          target="_blank"
          rel="noreferrer"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M23 7s-.2-1.7-.9-2.5c-.9-.9-1.9-.9-2.4-1C16.3 3.2 12 3.2 12 3.2s-4.3 0-7.7.3c-.5.1-1.5.1-2.4 1C1.2 5.3 1 7 1 7S.8 9 .8 11v2c0 2 .2 4 .2 4s.2 1.7.9 2.5c.9.9 2.1.9 2.6 1 1.9.2 7.5.3 7.5.3s4.3 0 7.7-.3c.5-.1 1.5-.1 2.4-1 .7-.8.9-2.5.9-2.5s.2-2 .2-4v-2c0-2-.2-4-.2-4ZM9.7 15.4V8.5l6.6 3.5-6.6 3.4Z" />
          </svg>
        </a>
        <a
          aria-label="Instagram"
          title="Instagram"
          href="https://www.instagram.com/macrodotcom/"
          target="_blank"
          rel="noreferrer"
        >
          <IconInstagram aria-hidden="true" />
        </a>
      </nav>
    </aside>
  );
}
