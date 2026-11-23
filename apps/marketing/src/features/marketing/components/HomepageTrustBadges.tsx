import { createSignal, onCleanup, onMount } from 'solid-js';
import IconCasa from '../../../assets/designs/design-casa.svg';
import IconIso from '../../../assets/designs/design-iso.svg';
import IconSoc2 from '../../../assets/designs/design-soc2.svg';
import LogoA16z from '../../../assets/logos/a16z.svg';
import './homepage-trust-badges.css';

/** Backing and security certifications shared by public website sections. */
export function HomepageTrustBadges(props: { revealOnScroll?: boolean } = {}) {
  let badges!: HTMLDivElement;
  const [revealed, setRevealed] = createSignal(!props.revealOnScroll);

  onMount(() => {
    if (!props.revealOnScroll) return;
    const scroller = badges.closest<HTMLElement>('.macro-home-scroll');
    if (!scroller) return;
    const reveal = () => {
      const bounds = badges.firstElementChild!.getBoundingClientRect();
      const viewport = scroller.getBoundingClientRect();
      if (
        scroller.scrollTop > 0 &&
        bounds.top < viewport.bottom - 40 &&
        bounds.bottom > viewport.top
      ) {
        setRevealed(true);
        scroller.removeEventListener('scroll', reveal);
      }
    };
    scroller.addEventListener('scroll', reveal, { passive: true });
    reveal();
    onCleanup(() => scroller.removeEventListener('scroll', reveal));
  });

  return (
    <div
      ref={badges}
      class="homepage-open-source-badges"
      data-revealed={revealed()}
    >
      <div class="homepage-open-source-backing">
        <LogoA16z aria-label="Andreessen Horowitz" viewBox="0 0 169 40" />
        <span>Led by a16z · $30M+ raised</span>
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
