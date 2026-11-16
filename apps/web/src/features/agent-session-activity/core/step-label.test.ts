import { describe, expect, it } from 'vitest';
import { stepLabelKey } from './step-label';

describe('stepLabelKey', () => {
  it('names SDK verbs and stored action tags', () => {
    expect(stepLabelKey('edited')).toBe('agentWork.stepEdited');
    expect(stepLabelKey('property_changed')).toBe(
      'agentWork.stepPropertyChanged'
    );
  });

  it('reads an unknown tag as a generic change, never the raw tag', () => {
    expect(stepLabelKey('some_future_tag')).toBe('agentWork.stepChanged');
  });
});
