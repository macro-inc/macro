import { describe, expect, test } from 'bun:test';
import { MacroApiError, withOptionNames } from './unwrap';

const NAMES = { data_type: 'dataType', display_name: 'displayName' };

describe('withOptionNames', () => {
  test('a 422 names the option behind each field of the method it mentions', () => {
    const error = withOptionNames(
      new MacroApiError(
        422,
        'Failed to deserialize the JSON body into the target type: data_type: invalid type: string "NUMBER", expected internally tagged enum PropertyDataType at line 1 column 40',
      ),
      NAMES,
    ) as MacroApiError;

    expect(error.status).toBe(422);
    expect(error.message).toContain('data_type: invalid type');
    expect(error.message).toContain(
      '(`data_type` is the `dataType` option; read the method',
    );
  });

  test('fields and values outside the method’s map, and other errors, are left alone', () => {
    const passedThrough = new MacroApiError(
      422,
      'option: missing field `display_order`; unknown variant `x`, expected `select_string`',
    );
    expect(
      (withOptionNames(passedThrough, NAMES) as MacroApiError).message,
    ).toBe(
      'Macro API error 422: option: missing field `display_order`; unknown variant `x`, expected `select_string`',
    );
    expect(
      (
        withOptionNames(
          new MacroApiError(400, 'data_type is taken'),
          NAMES,
        ) as MacroApiError
      ).message,
    ).toBe('Macro API error 400: data_type is taken');
    const other = new Error('network down');
    expect(withOptionNames(other, NAMES)).toBe(other);
  });
});
