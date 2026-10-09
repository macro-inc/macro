import { describe, expect, it } from 'vitest';
import type { FormColumnKind } from './form-model';
import {
  hasOptions,
  QUESTION_TYPE_CHOICES,
  questionTypeLabel,
  questionTypeOf,
  resolvedWidget,
  sameColumnKind,
  widgetFits,
  widgetsFor,
} from './question-types';

describe('widgetsFor', () => {
  it('follows the RFC 01 §4 table, default first', () => {
    expect(widgetsFor({ type: 'text' })).toEqual(['short', 'paragraph']);
    expect(widgetsFor({ type: 'number' })).toEqual([]);
    expect(widgetsFor({ type: 'boolean' })).toEqual([]);
    expect(widgetsFor({ type: 'date' })).toEqual(['datetime', 'date']);
    expect(widgetsFor({ type: 'link' })).toEqual(['url', 'file']);
    expect(widgetsFor({ type: 'select', multi: false })).toEqual([
      'choice',
      'dropdown',
    ]);
    expect(widgetsFor({ type: 'select', multi: true })).toEqual(['checkboxes']);
    expect(widgetsFor({ type: 'select_number', multi: false })).toEqual([
      'dropdown',
    ]);
    expect(widgetsFor({ type: 'tag' })).toEqual(['checkboxes']);
    expect(
      widgetsFor({ type: 'entity', target: 'USER', multi: false })
    ).toEqual([]);
    expect(widgetsFor({ type: 'relation', database: 'd', table: 't' })).toEqual(
      []
    );
  });

  it('accepts null or a fitting widget only', () => {
    expect(widgetFits({ type: 'text' }, null)).toBe(true);
    expect(widgetFits({ type: 'text' }, 'paragraph')).toBe(true);
    expect(widgetFits({ type: 'text' }, 'choice')).toBe(false);
    expect(resolvedWidget({ type: 'text' }, null)).toBe('short');
    expect(resolvedWidget({ type: 'number' }, null)).toBe(null);
  });
});

describe('questionTypeOf', () => {
  it('reads every menu choice back as itself', () => {
    for (const choice of QUESTION_TYPE_CHOICES) {
      if (choice.kind === 'pick-table') continue;
      expect(questionTypeOf(choice.kind, choice.widget)).toBe(choice.id);
    }
    expect(
      questionTypeOf({ type: 'relation', database: 'd', table: 't' }, null)
    ).toBe('relation');
  });

  it('names kinds only an existing table has', () => {
    expect(questionTypeLabel({ type: 'tag' }, null)).toBe('Tags');
    expect(
      questionTypeLabel({ type: 'select_number', multi: false }, null)
    ).toBe('Number dropdown');
    expect(
      questionTypeLabel({ type: 'entity', target: 'USER', multi: true }, null)
    ).toBe('Persons');
    expect(
      questionTypeLabel(
        { type: 'entity', target: 'PROJECT', multi: false },
        null
      )
    ).toBe('Project');
    expect(questionTypeLabel({ type: 'boolean' }, null)).toBe('Checkbox');
  });
});

it('knows which kinds have options', () => {
  expect(hasOptions({ type: 'select', multi: true })).toBe(true);
  expect(hasOptions({ type: 'tag' })).toBe(true);
  expect(hasOptions({ type: 'text' })).toBe(false);
});

describe('sameColumnKind', () => {
  it('compares kinds by their facts, whatever order they were written in', () => {
    const fromWire: FormColumnKind = { multi: true, type: 'select' } as const;
    expect(sameColumnKind(fromWire, { type: 'select', multi: true })).toBe(
      true
    );
    expect(sameColumnKind(fromWire, { type: 'select', multi: false })).toBe(
      false
    );
    expect(
      sameColumnKind(
        { table: 't', database: 'd', type: 'relation' },
        { type: 'relation', database: 'd', table: 't' }
      )
    ).toBe(true);
    expect(sameColumnKind({ type: 'text' }, { type: 'number' })).toBe(false);
  });
});
