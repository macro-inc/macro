/** One automatic review decision per entity during a navigation visit. */
export function createVisitReview() {
  let visit: string | undefined;
  const considered = new Set<string>();
  return {
    navigate(key: string) {
      if (visit === key) return;
      visit = key;
      considered.clear();
    },
    claim(entity: string) {
      if (considered.has(entity)) return false;
      considered.add(entity);
      return true;
    },
  };
}
