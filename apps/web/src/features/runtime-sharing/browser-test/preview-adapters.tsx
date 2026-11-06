export const OWNER_ID = 'macro|owner@example.com';

const TEAM = {
  team: { id: '0198a4cc-e138-7670-a308-a6b7666027aa', name: 'Sample team' },
  members: [
    { user_id: OWNER_ID },
    { user_id: 'macro|alice@example.com' },
    { user_id: 'macro|bob@example.com' },
  ],
};

export const useUserId = () => () => OWNER_ID;
export const useIsAuthenticated = () => () => true;
export const useEmail = () => () => 'owner@example.com';

export const useCurrentTeamQuery = () => ({ isSuccess: true, data: TEAM });

export const OwnerLabel = (props: { ownerId: string }) => (
  <span class="text-sm text-ink">{props.ownerId.replace('macro|', '')}</span>
);
