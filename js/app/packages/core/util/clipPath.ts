/**
 * Builds a chamfered-rectangle polygon path from corner sizes
 * in TL, TR, BR, BL order and returns a complete `clip-path: polygon(...);` string.
 *
 * Example:
 * <div
 *   class="w-10 h-4 bg-accent"
 *   style={{
 *     'clip-path': cornerClip(0, "1rem", 0, 0)
 *   }}
 * />
 *
 * Or use a single value for all corners:
 * <div
 *   style={{
 *     'clip-path': cornerClip("0.5rem")
 *   }}
 * />
 */
export function cornerClip(all: 0 | string): string;
export function cornerClip(
  tl: 0 | string,
  tr: 0 | string,
  br: 0 | string,
  bl: 0 | string
): string;
export function cornerClip(
  tl: 0 | string,
  tr?: 0 | string,
  br?: 0 | string,
  bl?: 0 | string
): string {
  // If only one argument is provided, use it for all corners
  if (tr === undefined && br === undefined && bl === undefined) {
    tr = br = bl = tl;
  }

  const sub100 = (s: 0 | string) =>
    s === '0' || s === 0 ? '100%' : `calc(100% - ${s.replace('calc', '')})`;
  // starting near top-left
  // (tl,0) → (100%-tr,0) → (100%,tr) → (100%,100%-br) → (100%-bl,100%) → (bl,100%) → (0,100%-bl) → (0,tl)
  const points = [
    `${tl} 0`,
    `${sub100(tr!)} 0`,
    `100% ${tr}`,
    `100% ${sub100(br!)}`,
    `${sub100(br!)} 100%`,
    `${bl} 100%`,
    `0 ${sub100(bl!)}`,
    `0 ${tl}`,
  ].join(', ');
  return `polygon(${points})`;
}
