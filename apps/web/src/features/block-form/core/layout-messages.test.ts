import { describe, expect, it } from 'vitest';
import type { FormLayout, FormSection } from './form-model';
import {
  layoutRefusalMessage,
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
    bookingTarget: null,
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
    expect(sectionName(layout, 'first-gate')).toBe('Screener 1');
    expect(sectionName(layout, 'second-gate')).toBe('Screener 2');
  });
});

describe('routingLine', () => {
  it('names the gates checked on the way, and a trailing gate before submitting', () => {
    expect(routingLine(layout, 'about')).toBe(
      'Check screener, then continue to section 2'
    );
    expect(routingLine(layout, 'logistics')).toBe(
      'Check screener, then submit'
    );
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

describe('booking step', () => {
  const booked: FormLayout = {
    sections: [
      section('about', 'questions', 'About you'),
      section('fit', 'gate'),
      section('call', 'booking'),
    ],
  };

  it('is named Booking until titled, and the last section submits then books', () => {
    expect(sectionName(booked, 'call')).toBe('Booking');
    expect(routingLine(booked, 'about')).toBe(
      'Check screener, then submit and book a time'
    );
    expect(
      routingLine(
        {
          sections: [
            section('about', 'questions'),
            section('call', 'booking', 'Intro call'),
          ],
        },
        'about'
      )
    ).toBe('Submit, then book a time');
  });

  it('explains why it stays last and takes no questions', () => {
    const names = {
      section: (sectionId: string) => sectionName(booked, sectionId),
      column: () => 'Team',
    };
    expect(
      layoutRefusalMessage(
        { kind: 'booking-must-be-last', sectionId: 'call' },
        names
      )
    ).toBe(
      'The booking step comes last, after every question and screener. Move “Booking” to the end.'
    );
    expect(
      layoutRefusalMessage(
        { kind: 'booking-section', sectionId: 'call' },
        names
      )
    ).toBe(
      'The booking step shows a calendar, not questions. Drop it in a section.'
    );
  });
});
