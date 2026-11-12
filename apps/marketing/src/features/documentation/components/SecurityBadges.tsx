import IconCasa from '../../../assets/designs/design-casa.svg';
import IconIso from '../../../assets/designs/design-iso.svg';
import IconSoc2 from '../../../assets/designs/design-soc2.svg';
import './security-badges.css';

export function SecurityBadges() {
  return (
    <div class="security-badges" aria-label="Security and compliance">
      <div>
        <IconIso aria-hidden="true" />
        <span>ISO 27001</span>
      </div>
      <div>
        <IconSoc2 aria-hidden="true" />
        <span>SOC 2 Type II</span>
      </div>
      <div>
        <IconCasa aria-hidden="true" />
        <span>CASA Tier 2</span>
      </div>
    </div>
  );
}
