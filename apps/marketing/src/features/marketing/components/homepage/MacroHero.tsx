import { routePhoneToMobileSignup } from '../../core/navigation';
import './macro-hero.css';

/** Centered homepage introduction. */
export function MacroHero() {
  return (
    <div class="macro-text-hero">
      <div class="macro-text-hero-copy">
        <h1 id="macro-home-title" data-welcome-heading>
          The unified workspace
          <br />
          for your company.
        </h1>
        <p>
          Your email, chat, tasks, docs, agents and CRM in one tab with team
          level memory for agents.
        </p>
        <a
          class="site-nav-start homepage-hero-cta macro-home-button"
          href="/app/signup"
          onClick={routePhoneToMobileSignup}
        >
          Get started <span aria-hidden="true">→</span>
        </a>
      </div>
    </div>
  );
}
