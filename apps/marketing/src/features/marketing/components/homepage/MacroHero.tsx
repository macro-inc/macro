import { routePhoneToMobileSignup } from '../../core/navigation';
import './macro-hero.css';

const homepageDescription =
  'Macro replaces 27+ apps with one connected system designed for humans and agents.';

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
        <h2>{homepageDescription}</h2>
        <a
          class="site-nav-start homepage-hero-cta macro-home-button"
          href="/app/signup"
          onClick={routePhoneToMobileSignup}
        >
          Sign Up <span aria-hidden="true">→</span>
        </a>
      </div>
    </div>
  );
}
