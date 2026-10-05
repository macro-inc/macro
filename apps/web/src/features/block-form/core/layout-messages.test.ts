import { describe, expect, it } from 'vitest';
import type { FormLayout, FormSection } from './form-model';
import {
  placementDescription,
  routingLine,
  sectionName,
} from './layout-messages';

function section(
  id: string,
  kind: FormSection['kind'],
  title = ''
): FormSection {
  return {
    id,
    title,
    description: '',
    kind,
    gateRules: kind === 'gate' ? { conjunction: 'and', conditions: [] } : null,
    gateMessage: '',
    questions: [],
  };
}

const layout: FormLayout = {
  sections: [
    section('about', 'questions', 'About you'),
    section('first-gate', 'gate'),
    section('logistics', 'questions'),
    section('second-gate', 'gate'),
  ],
};

describe('sectionName', () => {
  it('numbers question sections and gates separately, as their cards do', () => {
    expect(sectionName(layout, 'about')).toBe('About you');
    expect(sectionName(layout, 'logistics')).toBe('Section 2');
    expect(sectionName(layout, 'first-gate')).toBe('Gate 1');
    expect(sectionName(layout, 'second-gate')).toBe('Gate 2');
  });
});

describe('routingLine', () => {
  it('names the gates checked on the way, and a trailing gate before submitting', () => {
    expect(routingLine(layout, 'about')).toBe(
      'Check gate, then continue to section 2'
    );
    expect(routingLine(layout, 'logistics')).toBe('Check gate, then submit');
    expect(
      routingLine({ sections: [section('only', 'questions')] }, 'only')
    ).toBe('Submit form');
  });
});

describe('placementDescription', () => {
  it('numbers the target among question sections, as the cards do', () => {
    expect(
      placementDescription(layout, 'moved', {
        sectionId: 'logistics',
        index: 0,
      })
    ).toBe('Section 2, position 1 of 1');
    expect(
      placementDescription(layout, 'moved', { sectionId: 'about', index: 0 })
    ).toBe('Section 1 (About you), position 1 of 1');
  });
});
