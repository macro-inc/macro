import { describe, expect, it } from 'vitest';
import { CRM_DEMO_DURATION, crmDemoFrame } from './crm-demo';

describe('CRM walkthrough', () => {
  it('keeps companies in their original stage until the card is released', () => {
    expect(crmDemoFrame(3500)).toMatchObject({
      dragging: true,
      company: 'northwind',
      northwindStage: 0,
    });
    expect(crmDemoFrame(4800)).toMatchObject({
      dragging: false,
      northwindStage: 1,
      lumenStage: 1,
    });
    expect(crmDemoFrame(9000)).toMatchObject({
      dragging: true,
      company: 'lumen',
      lumenStage: 1,
    });
    expect(crmDemoFrame(10600)).toMatchObject({
      dragging: false,
      northwindStage: 1,
      lumenStage: 2,
    });
  });
  it('lands the dragged card at the destination and finishes with a clean board', () => {
    expect(crmDemoFrame(4600)).toMatchObject({ x: 394, y: 146 });
    expect(crmDemoFrame(10400)).toMatchObject({ x: 678, y: 146 });
    expect(crmDemoFrame(CRM_DEMO_DURATION)).toMatchObject({
      opacity: 0,
      dragging: false,
      northwindStage: 1,
      lumenStage: 2,
    });
    expect(crmDemoFrame(0)).toMatchObject({
      opacity: 0,
      northwindStage: 0,
      lumenStage: 1,
    });
  });
});
