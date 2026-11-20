import { describe, expect, test } from 'bun:test';
import { MacroApiError } from './unwrap';

describe('MacroApiError', () => {
  test('a 422 names the SDK option for each API field it mentions', () => {
    const error = new MacroApiError(
      422,
      'Failed to deserialize the JSON body into the target type: data_type: invalid type: string "NUMBER", expected internally tagged enum PropertyDataType at line 1 column 40',
    );

    expect(error.message).toContain('data_type: invalid type');
    expect(error.message).toContain(
      '(in SDK options, `data_type` is `dataType`; read the method',
    );
  });

  test('other statuses and 422s without field names are left as the server said', () => {
    expect(new MacroApiError(400, 'display_name is taken').message).toBe(
      'Macro API error 400: display_name is taken',
    );
    expect(new MacroApiError(422, 'missing body').message).toBe(
      'Macro API error 422: missing body',
    );
  });
});
