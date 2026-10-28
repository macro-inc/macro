/** Morph a continuous ribbon of the demo gradient into the GitHub mark. */
export function animateGithubFlow(section: HTMLElement, scroller: HTMLElement) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const stage = section.parentElement!.querySelector<HTMLElement>(
    '.homepage-embedded-wallpaper'
  )!;
  const flow = section.querySelector<SVGSVGElement>('.homepage-github-flow')!;
  const liquid = flow.querySelector<SVGPathElement>('.homepage-github-liquid')!;
  const current = flow.querySelector<SVGPathElement>(
    '.homepage-github-current'
  )!;
  const mark = section.querySelector<HTMLElement>('.homepage-github-mark')!;
  let start = 0;
  let distance = 1;
  let last = -1;
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  const update = () => {
    const progress = reduced.matches
      ? 1
      : clamp((scroller.scrollTop - start) / distance);
    if (last === progress) return;
    last = progress;
    const gathering = clamp(progress / 0.72);
    const draining = clamp((progress - 0.72) / 0.28);
    const reach = 260 + 640 * (1 - (1 - gathering) ** 3);
    const bend = Math.sin(gathering * Math.PI) * 55;
    const neck = 8 + (1 - gathering) * 36;
    // One curved surface gathers into a narrow neck; it never breaks into particles.
    liquid.setAttribute(
      'd',
      `M 0 0 C 80 180, ${390 + bend} ${reach * 0.12}, ${460 + bend} ${reach * 0.43} C ${500 + bend} ${reach * 0.64}, ${600 - neck} ${reach * 0.72}, ${600 - neck} ${reach - 55} Q ${600 - neck} ${reach}, 600 ${reach} Q ${600 + neck} ${reach}, ${600 + neck} ${reach - 55} C ${600 + neck} ${reach * 0.7}, ${710 + bend} ${reach * 0.55}, ${760 + bend} ${reach * 0.3} C ${820 + bend} ${reach * 0.1}, 1100 180, 1200 0 Z`
    );
    current.setAttribute(
      'd',
      `M 1060 0 C 930 180, ${745 + bend} ${reach * 0.12}, ${710 + bend} ${reach * 0.39} S 610 ${reach * 0.76}, 604 ${reach - 20}`
    );
    flow.style.opacity = `${clamp(progress * 4) * (1 - draining ** 3)}`;
    flow.style.maskImage =
      draining > 0
        ? `linear-gradient(to bottom, transparent ${Math.max(0, draining * 100 - 12)}%, black ${draining * 100}%)`
        : 'none';
    const power = clamp((progress - 0.45) / 0.3);
    section.style.setProperty('--github-power', `${power}`);
    section.style.setProperty('--github-scale', `${0.86 + 0.14 * power}`);
  };
  const measure = () => {
    const bounds = section.getBoundingClientRect();
    const source = stage.getBoundingClientRect();
    const target = mark.getBoundingClientRect();
    const viewport = scroller.getBoundingClientRect();
    const scale = section.offsetWidth / bounds.width;
    const top = (source.bottom - 220 - bounds.top) * scale;
    const end = (target.top + target.height / 2 - bounds.top) * scale;
    flow.style.top = `${top}px`;
    flow.style.height = `${Math.max(1, end - top)}px`;
    start =
      source.bottom -
      viewport.top +
      scroller.scrollTop -
      scroller.clientHeight * 0.85;
    distance = Math.max(
      1,
      target.top +
        target.height / 2 -
        viewport.top +
        scroller.scrollTop -
        scroller.clientHeight * 0.32 -
        start
    );
    last = -1;
    update();
  };
  const resize = new ResizeObserver(measure);
  resize.observe(section.parentElement!);
  resize.observe(scroller);
  scroller.addEventListener('scroll', update, { passive: true });
  reduced.addEventListener('change', measure);
  measure();
  return () => {
    resize.disconnect();
    scroller.removeEventListener('scroll', update);
    reduced.removeEventListener('change', measure);
  };
}
