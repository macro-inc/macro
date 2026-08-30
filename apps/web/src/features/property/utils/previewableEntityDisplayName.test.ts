import { describe, expect, it } from 'vitest';
import { SYSTEM_PROPERTY_IDS } from '../constants';
import type { Property } from '../types';
import {
  emailThreadSubjectFallback,
  previewableEntityDisplayName,
} from './previewableEntityDisplayName';

const noAccessPreview = {
  access: 'no_access',
  loading: false,
};

const accessPreview = {
  access: 'access',
  loading: false,
  name: 'Partnering with Macro at our AI hackathon',
};

const subjectProperty: Property = {
  propertyId: 'subject-row',
  propertyDefinitionId: SYSTEM_PROPERTY_IDS.SUBJECT,
  displayName: 'Subject',
  isMultiSelect: false,
  owner: { scope: 'system' },
  createdAt: new Date(0),
  updatedAt: new Date(0),
  valueType: 'STRING',
  value: 'Partnering with Macro at our AI hackathon',
};

describe('previewableEntityDisplayName', () => {
  it('uses the live preview name when the thread is accessible', () => {
    expect(
      previewableEntityDisplayName(
        'THREAD',
        accessPreview,
        subjectProperty.value ?? undefined
      )
    ).toBe('Partnering with Macro at our AI hackathon');
  });

  it('uses the sibling Subject when a THREAD preview is inaccessible', () => {
    expect(
      previewableEntityDisplayName(
        'THREAD',
        noAccessPreview,
        'Partnering with Macro at our AI hackathon'
      )
    ).toBe('Partnering with Macro at our AI hackathon');
  });

  it('keeps Unknown thread when there is no sibling Subject', () => {
    expect(previewableEntityDisplayName('THREAD', noAccessPreview)).toBe(
      'Unknown thread'
    );
  });
});

describe('emailThreadSubjectFallback', () => {
  it('returns Subject only for THREAD entities', () => {
    expect(emailThreadSubjectFallback('THREAD', [subjectProperty])).toBe(
      'Partnering with Macro at our AI hackathon'
    );
    expect(emailThreadSubjectFallback('DOCUMENT', [subjectProperty])).toBe(
      undefined
    );
  });
});
