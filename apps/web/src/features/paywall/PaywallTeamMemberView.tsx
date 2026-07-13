import UsersThreeIcon from '@phosphor/users-three.svg';

const PaywallTeamMemberView = () => (
  <div class="relative space-y-2 w-full">
    <div class="p-4 sm:p-5 border border-edge flex flex-col gap-3 text-left rounded-sm">
      <div class="flex justify-between items-start">
        <div class="flex items-center gap-2 font-semibold text-ink text-base sm:text-lg">
          <UsersThreeIcon class="size-5 shrink-0 text-accent" />
          Team subscription
        </div>
      </div>
      <div class="text-sm text-ink/60 flex flex-col gap-1">
        <span>
          Your subscription is managed by your team owner. Contact them to make
          changes.
        </span>
      </div>
    </div>
  </div>
);

export default PaywallTeamMemberView;
