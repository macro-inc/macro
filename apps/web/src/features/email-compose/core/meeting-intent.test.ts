import { expect, it } from 'vitest';
import { proposesMeeting } from './meeting-intent';

it.each([
  'Want to meet tomorrow at 2 pm?',
  'Can we hop on a call Thursday?',
  'Are you available next week for a demo?',
  'Lunch on Friday at 12:30?',
  "I'll send an invite for 3pm",
])('suggests an event for %j', (text) => {
  expect(proposesMeeting(text)).toBe(true);
});

it.each([
  '',
  'Thanks, the report looks great.',
  'Can we meet sometime?',
  'I will send it tomorrow.',
  'The meeting notes are attached.',
  'Recall the numbers from Tuesday.',
])('does not suggest an event for %j', (text) => {
  expect(proposesMeeting(text)).toBe(false);
});
