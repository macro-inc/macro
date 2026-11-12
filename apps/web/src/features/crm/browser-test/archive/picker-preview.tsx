// Synthetic data at the Tasks picker service boundary; selection, search,
// focus, keyboard handling and mobile sheet remain production components.
export const useEmail = () => () => 'viewer@example.com';
export const useUserId = () => () => 'viewer';
export const useAugmentUserWithDmActivity = () => (user: unknown) => user;
export const emailToId = (email: string) => email;
export const UserIcon = () => null;
export const useSearchSoupQuery = () => ({
  status: 'success',
  data: [],
  isFetching: false,
});
export const useQuickAccess = () => ({
  isLoading: () => false,
  useList: () => ({
    items: () =>
      ['Example company', 'Second company'].map((name, index) => ({
        kind: 'entity',
        id: `company-${index + 1}`,
        data: {
          type: 'crm_company',
          id: `company-${index + 1}`,
          name,
          updatedAt: new Date('2026-10-15'),
        },
      })),
  }),
});
