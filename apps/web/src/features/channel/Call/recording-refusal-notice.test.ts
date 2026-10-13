import { describe, expect, it } from 'vitest';
import { recordingRefusalNotice } from './recording-refusal-notice';

const names: Record<string, string> = {
  'macro|sam@example.com': 'Sam',
  'macro|alex@example.com': 'Alex',
};
const nameOf = (id: string) => names[id] ?? 'Someone';

describe('recording refusal notice', () => {
  it('says nothing when nobody refuses', () => {
    expect(recordingRefusalNotice([], 'macro|alex@example.com', nameOf)).toBe(
      null
    );
  });

  it('names the other person who refuses', () => {
    expect(
      recordingRefusalNotice(
        ['macro|sam@example.com'],
        'macro|alex@example.com',
        nameOf
      )
    ).toBe("Not recording or transcribing: Sam doesn't allow 1:1 recordings");
  });

  it('tells the viewer when they are the one refusing', () => {
    expect(
      recordingRefusalNotice(
        ['macro|alex@example.com'],
        'macro|alex@example.com',
        nameOf
      )
    ).toBe("Not recording or transcribing: you don't allow 1:1 recordings");
  });

  it('names both people when both refuse', () => {
    expect(
      recordingRefusalNotice(
        ['macro|sam@example.com', 'macro|alex@example.com'],
        'macro|alex@example.com',
        nameOf
      )
    ).toBe(
      "Not recording or transcribing: you and Sam don't allow 1:1 recordings"
    );
  });
});
