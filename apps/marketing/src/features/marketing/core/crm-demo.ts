export const CRM_DEMO_DURATION = 14000;
export const CRM_DEMO_COMPANIES = [
  {
    id: 'northwind',
    name: 'Keystone Mechanical',
    domain: 'keystone.example',
    stage: 0,
    initials: 'K',
  },
  {
    id: 'fieldnote',
    name: 'Panelwork Research',
    domain: 'panelwork.example',
    stage: 0,
    initials: 'P',
  },
  {
    id: 'lumen',
    name: 'Bookend Retail',
    domain: 'bookend.example',
    stage: 1,
    initials: 'B',
  },
  {
    id: 'relay',
    name: 'Replywell',
    domain: 'replywell.example',
    stage: 2,
    initials: 'R',
  },
] as const;

const ease = (t: number) => {
  const p = Math.max(0, Math.min(1, t));
  return p * p * (3 - 2 * p);
};
const between = (t: number, start: number, end: number) =>
  ease((t - start) / (end - start));
const mix = (a: number, b: number, p: number) => a + (b - a) * p;

/** One local walkthrough; stage changes happen on release, never on pickup. */
export function crmDemoFrame(t: number) {
  const second = t >= 6200;
  const travel = second ? between(t, 7600, 10400) : between(t, 2000, 4600);
  const dragging = second ? t >= 7600 && t < 10600 : t >= 2000 && t < 4800;
  const approach = second ? between(t, 6200, 7400) : between(t, 600, 1800);
  const x = second
    ? 394 + 284 * travel
    : mix(100, 110, approach) + 284 * travel;
  const y = second
    ? mix(146, 76, approach) + 70 * travel
    : mix(270, 76, approach) + 70 * travel;
  return {
    x,
    y,
    opacity: between(t, 200, 600) * (1 - between(t, 11600, 12100)),
    dragging,
    company: second ? 'lumen' : 'northwind',
    target: second ? 2 : 1,
    travel,
    northwindStage: t >= 4800 ? 1 : 0,
    lumenStage: t >= 10600 ? 2 : 1,
    status:
      t >= 10600
        ? 'Keystone Mechanical → Proposal · Bookend Retail → Closed won'
        : second
          ? 'Moving Bookend Retail to Closed won'
          : 'Moving Keystone Mechanical to Proposal',
  };
}
