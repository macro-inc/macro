/**
 * Load block data and its lazy component in parallel, but do not publish the
 * data until the component module has evaluated. Some legacy block modules
 * register top-level effects during evaluation, and those registrations must
 * exist before BlockEffectRunner reacts to the loaded data.
 */
export async function loadBlockDataAfterComponentPreload<T>(
  load: () => Promise<T>,
  preload?: () => Promise<unknown>
): Promise<T> {
  const componentPromise = preload?.() ?? Promise.resolve();
  const dataPromise = load();
  const [result] = await Promise.all([dataPromise, componentPromise]);
  return result;
}
