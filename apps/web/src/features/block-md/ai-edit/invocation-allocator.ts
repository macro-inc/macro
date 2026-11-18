/** Largest token the native `group-c.ai-op` command accepts (u32). */
export const MAX_INVOCATION = 0xffff_ffff;

/** Checked, non-wrapping correlation tokens: each is issued once, in order;
 *  past `max` the allocator throws before a token is issued. */
export type InvocationAllocator = { readonly next: () => number };

export function createInvocationAllocator(
  first = 1,
  max = MAX_INVOCATION
): InvocationAllocator {
  if (
    !Number.isSafeInteger(first) ||
    !Number.isSafeInteger(max) ||
    first < 1 ||
    max > MAX_INVOCATION
  )
    throw new Error('Invalid AI edit invocation range');
  let following = first;
  return {
    next: () => {
      if (following > max)
        throw new Error(
          'AI edit invocation tokens are exhausted for this editor'
        );
      const token = following;
      following += 1;
      return token;
    },
  };
}
