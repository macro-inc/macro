import IconCasa from '../../../../marketing/src/assets/designs/design-casa.svg';
import IconIso from '../../../../marketing/src/assets/designs/design-iso.svg';
import IconSoc2 from '../../../../marketing/src/assets/designs/design-soc2.svg';
import './homepage-reassurance.css';

/** Shared, unchanged social proof for the homepage and signup. */
export function HomepageReassurance() {
  return (
    <div class="homepage-app-reassurance">
      <p>Join 170k+ users.</p>
      <p>Free personal account. No credit card required.</p>
      <div class="homepage-app-security" aria-label="Security certifications">
        <IconIso aria-label="ISO 27001" />
        <IconSoc2 aria-label="AICPA SOC 2" />
        <IconCasa aria-label="CASA Tier 2" />
      </div>
      <p class="homepage-app-security-caption">
        ISO 27001 · SOC 2 · CASA Tier 2
      </p>
    </div>
  );
}
