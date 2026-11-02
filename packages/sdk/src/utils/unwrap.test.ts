import { expect, test } from 'bun:test';
import { MacroApiError, unwrap } from './unwrap';

test('a text 400 body is the MacroApiError message and body', () => {
  expect(() =>
    unwrap({
      error: 'trigger.schedule: invalid cron schedule "not a cron"',
      response: new Response(null, { status: 400 }),
    }),
  ).toThrow(MacroApiError);
  try {
    unwrap({
      error: 'trigger.schedule: invalid cron schedule "not a cron"',
      response: new Response(null, { status: 400 }),
    });
  } catch (error) {
    expect(error).toBeInstanceOf(MacroApiError);
    const api = error as MacroApiError;
    expect(api.status).toBe(400);
    expect(api.body).toBe(
      'trigger.schedule: invalid cron schedule "not a cron"',
    );
    expect(api.data).toBe(api.body);
    expect(api.message).toBe(
      'Macro API error 400: trigger.schedule: invalid cron schedule "not a cron"',
    );
  }
});

test('a JSON 400 body names the field in the message', () => {
  try {
    unwrap({
      error: { error: 'invalid cron schedule', field: 'trigger.schedule' },
      response: new Response(null, { status: 400 }),
    });
  } catch (error) {
    const api = error as MacroApiError;
    expect(api.status).toBe(400);
    expect(api.body).toEqual({
      error: 'invalid cron schedule',
      field: 'trigger.schedule',
    });
    expect(api.message).toBe(
      'Macro API error 400: trigger.schedule: invalid cron schedule',
    );
  }
});

test('an empty 400 body keeps the status-only message', () => {
  try {
    unwrap({ error: {}, response: new Response(null, { status: 400 }) });
  } catch (error) {
    const api = error as MacroApiError;
    expect(api.message).toBe('Macro API error 400');
    expect(api.body).toEqual({});
  }
});
