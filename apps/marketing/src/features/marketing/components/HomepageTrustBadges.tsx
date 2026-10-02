import IconCasa from '../../../assets/designs/design-casa.svg';
import IconIso from '../../../assets/designs/design-iso.svg';
import IconSoc2 from '../../../assets/designs/design-soc2.svg';
import LogoA16z from '../../../assets/logos/a16z.svg';
import './homepage-github.css';

/** a16z backing and security certifications from the homepage's open-source section. */
export function HomepageTrustBadges() {
  return (
    <div class="homepage-open-source-badges">
      <div class="homepage-open-source-backing">
        <LogoA16z aria-label="Andreessen Horowitz" viewBox="0 0 169 40" />
        <span>Backed by a16z · $30M+ raised</span>
      </div>
      <div class="homepage-open-source-security">
        <div aria-label="Security certifications">
          <IconIso aria-label="ISO 27001" />
          <IconSoc2 aria-label="AICPA SOC 2" />
          <IconCasa aria-label="CASA Tier 2" />
        </div>
        <span>ISO 27001 · SOC 2 · CASA Tier 2</span>
      </div>
    </div>
  );
}
