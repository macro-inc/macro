// Non-user sources are disabled in this fixture. Keep the actual selector,
// people window and exact-selection reader; do not mount unrelated entity UI.
export function createEmailsInfiniteQuery() {
  return { data: [], isLoading: false, isPending: false };
}
export function useSearchSoupQuery() {
  return { status: 'success', data: [] };
}
export const validateSearchServiceText = (text: string) => text.length >= 3;
export const Entity = {
  Icon: () => {
    throw new Error('Unexpected non-user entity');
  },
  Title: () => {
    throw new Error('Unexpected non-user entity');
  },
};
