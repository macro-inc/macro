import { describe, expect, it } from 'vitest';
import { parseTimeSlashCommand } from './timeCommands';

describe('parseTimeSlashCommand', () => {
  it('matches exact command names', () => {
    expect(parseTimeSlashCommand('date')).toEqual({
      command: 'date',
      query: '',
    });
    expect(parseTimeSlashCommand('countdown')).toEqual({
      command: 'countdown',
      query: '',
    });
    expect(parseTimeSlashCommand('duration')).toEqual({
      command: 'duration',
      query: '',
    });
  });

  it('captures the remaining human-time query', () => {
    expect(parseTimeSlashCommand('countdown 3 days')).toEqual({
      command: 'countdown',
      query: '3 days',
    });
    expect(parseTimeSlashCommand('countdown in 2 hours')).toEqual({
      command: 'countdown',
      query: 'in 2 hours',
    });
    expect(parseTimeSlashCommand('date next wednesday')).toEqual({
      command: 'date',
      query: 'next wednesday',
    });
  });

  it('ignores partial command names', () => {
    expect(parseTimeSlashCommand('da')).toBeNull();
    expect(parseTimeSlashCommand('count')).toBeNull();
    expect(parseTimeSlashCommand('heading1')).toBeNull();
    expect(parseTimeSlashCommand('')).toBeNull();
  });
});
