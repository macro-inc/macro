import { expect, it } from 'vitest';
import { mobileClockValue } from './mobile-clock-value';

it('separates the meridiem without dropping zero minutes', () => {
  expect(mobileClockValue('11:00', '12-hour', 'en-US')).toEqual({
    time: '11:00',
    meridiem: 'am',
  });
  expect(mobileClockValue('13:45', '12-hour', 'en-US')).toEqual({
    time: '1:45',
    meridiem: 'pm',
  });
});

it('keeps midnight in the 24-hour clock without a meridiem', () => {
  expect(mobileClockValue('00:00', '24-hour', 'en-US')).toEqual({
    time: '00:00',
    meridiem: '',
  });
});

it('preserves localized day-period text and rejects invalid clock values', () => {
  expect(mobileClockValue('13:45', '12-hour', 'zh-CN').meridiem).toBe('下午');
  expect(mobileClockValue('', '12-hour', 'en-US')).toEqual({
    time: '',
    meridiem: '',
  });
  expect(mobileClockValue('25:00', '12-hour', 'en-US')).toEqual({
    time: '',
    meridiem: '',
  });
});
