/**
 * Insert item at specified index (and shift all other items down)
 *
 * Returns a new array (does not edit original array)
 */
export function withItemAtIndex<P>(arr: P[], item: P, index: number): P[] {
  if (index < 0) {
    console.error('index cannot be less than 0');
  }
  if (index > arr.length) {
    console.error('index cannot be greater than array length');
  }

  return [...arr.slice(0, index), item, ...arr.slice(index)];
}

export function areEqual(a: any[], b: any[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;

  const len = a.length;
  for (let i = 0; i < len; ++i) {
    if (!Object.is(a[i], b[i])) return false;
  }

  return true;
}

/**
 * simple and immutable array move util
 * @param input - input array
 * @param from - the target index to move the item from
 * @param to - the target index to move the item to
 * @returns - copy of the passed array with modifications applied
 */
export function move<T>(input: Array<T>, from: number, to: number): Array<T> {
  const output = [] as T[];
  // no modification required
  if (from === to) return input;
  const mod = from > to ? -1 : 1;
  for (let i = 0; i < input.length; i += 1) {
    if (i === to) {
      output.push(input[from]);
    } else if (i === from) {
      output.push(input[i + mod]);
    } else if ((i < to && i > from) || (i > to && i < from)) {
      output.push(input[i + mod]);
    } else {
      output.push(input[i]);
    }
  }
  return output;
}
