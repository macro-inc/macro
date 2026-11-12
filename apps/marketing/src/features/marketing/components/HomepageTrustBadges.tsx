import LogoA16z from '../../../assets/logos/a16z.svg';
import './homepage-github.css';

/** a16z backing from the homepage's open-source section. */
export function HomepageTrustBadges() {
  return (
    <div class="homepage-open-source-badges">
      <div class="homepage-open-source-backing">
        <LogoA16z aria-label="Andreessen Horowitz" viewBox="0 0 169 40" />
        <span>Backed by a16z · $30M+ raised</span>
      </div>
    </div>
  );
}
