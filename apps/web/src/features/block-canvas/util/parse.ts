/**
 * Helper function to parse numbers from query params. Can map varying input keys to the same output key.
 * @param mappings - Object mapping output keys to input keys
 * @returns A function that takes a set of query params and returns an object with the parsed values
 */
export function createNumericParser<T extends Record<string, number>>(
  mappings: Record<keyof T, string[]>
): (params: Record<string, any>) => T | null {
  return (params: Record<string, any>) => {
    const result = {} as T;
    let hasValidProperty = false;
    for (const [outputKey, inputKeys] of Object.entries(mappings)) {
      for (const inputKey of inputKeys) {
        if (inputKey in params) {
          const value = params[inputKey];
          const parsedValue = Number(value);

          if (!isNaN(parsedValue)) {
            (result as any)[outputKey] = parsedValue;
            hasValidProperty = true;
            break;
          }
        }
      }
    }
    return hasValidProperty ? (result as T) : null;
  };
}
