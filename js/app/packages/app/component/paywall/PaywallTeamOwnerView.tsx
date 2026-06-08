import { PLANS } from '@app/component/paywall/plans';
import { useTeamQuery } from '@queries/team';
import type { Team } from '@service-auth/generated/schemas/team';
import { stripeServiceClient } from '@service-stripe/client';
import { Button } from '@ui';
import { createMemo } from 'solid-js';
import SubscriptionTier from './SubscriptionTier';

interface PaywallTeamOwnerViewProps {
  team: Team;
}

const PREMIUM_PRICE = PLANS.find((p) => p.tier === 'premium')!.price;

const PaywallTeamOwnerView = (props: PaywallTeamOwnerViewProps) => {
  const teamQuery = useTeamQuery(() => props.team.id);
  const memberCount = createMemo(() => teamQuery.data?.members.length ?? 0);
  const totalPrice = createMemo(() => memberCount() * PREMIUM_PRICE);

  const handleManage = async () => {
    try {
      const url = await stripeServiceClient.createPortalSession();
      window.location.href = url;
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <div class="relative space-y-2 w-full">
      <div class="p-4 sm:p-5 bg-active flex flex-col gap-3 text-left rounded-sm">
        <div class="flex justify-between items-start">
          <div class="font-semibold text-ink text-base sm:text-lg">
            {props.team.name}
          </div>
          <SubscriptionTier class="w-7 shrink-0" tier="premium" />
        </div>
        <div class="flex items-baseline gap-0.5">
          <span class="text-3xl font-bold text-ink">${totalPrice()}</span>
          <span class="text-base text-ink/40">/mo</span>
        </div>
        <div class="text-sm text-ink/60 flex flex-col gap-1">
          <span>Plan: Premium</span>
          <span>Seats: {memberCount()}</span>
          <span>Price per seat: ${PREMIUM_PRICE}/mo</span>
        </div>
      </div>
      <div class="w-full">
        <Button
          onClick={handleManage}
          variant="base"
          size="lg"
          depth={3}
          class="w-full"
        >
          Manage Subscription
        </Button>
      </div>
    </div>
  );
};

export default PaywallTeamOwnerView;
