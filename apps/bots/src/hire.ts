import type {
  CreateTeamAgent,
  PurchaseOffers,
  PurchaseSizeOffer,
  TeamAgent,
} from '@macro-inc/sdk/generated/auth';

export type HireScope =
  | { status: 'signed-out' | 'no-team' | 'unavailable' }
  | {
      status: 'signed-in';
      account: string;
      session: string;
      team: string;
      teamName: string;
      role: 'owner' | 'admin' | 'member';
      teammatesEnabled: boolean;
      computersEnabled: boolean;
    };

type Buyer = Readonly<Extract<HireScope, { status: 'signed-in' }>>;
export type HireProfile = Pick<
  CreateTeamAgent,
  'name' | 'jobDescription' | 'personality' | 'avatarUrl' | 'voice'
>;

type Offers =
  | { status: 'quoted'; offers: PurchaseOffers }
  | {
      status: 'trial' | 'terms-unavailable' | 'denied' | 'unavailable';
    };

type Result =
  | { status: 'accepted'; agent: TeamAgent }
  | { status: 'no-room' | 'declined' | 'in-progress' | 'unknown' };

type Intent = {
  scope: Buyer;
  request: Readonly<CreateTeamAgent>;
};

export type CheckoutAdapter = {
  readScope(): Promise<HireScope>;
  readOffers(scope: Buyer): Promise<Offers>;
  submit(intent: Intent): Promise<Result>;
};

export type CheckoutState =
  | {
      status:
        | 'idle'
        | 'loading'
        | 'signed-out'
        | 'no-team'
        | 'denied'
        | 'unavailable'
        | 'trial'
        | 'terms-unavailable'
        | 'submitting'
        | 'unknown'
        | 'scope-changed';
    }
  | {
      status: 'review';
      team: string;
      offers: PurchaseOffers;
      notice?: 'quote-changed' | 'no-room' | 'declined' | 'invalid-profile';
    }
  | Extract<Result, { status: 'accepted' }>;

// Rust validates Unicode scalar values, which JavaScript's string iterator
// exposes without counting a surrogate pair twice.
function exceeds(value: string, limit: number) {
  let count = 0;
  for (const _ of value) {
    if (++count > limit) return true;
  }
  return false;
}

function canBuy(scope: HireScope): boolean {
  return (
    scope.status === 'signed-in' &&
    scope.role !== 'member' &&
    scope.teammatesEnabled &&
    scope.computersEnabled
  );
}

function sameScope(a: Buyer, b: HireScope) {
  return (
    b.status === 'signed-in' &&
    canBuy(b) &&
    a.account === b.account &&
    a.session === b.session &&
    a.team === b.team &&
    a.role === b.role
  );
}

function offerFor(offers: PurchaseOffers, size: PurchaseSizeOffer['size']) {
  return offers.sizes.find((offer) => offer.size === size && !offer.soldOut);
}

function sameOffer(
  before: PurchaseOffers,
  after: PurchaseOffers,
  offer: PurchaseSizeOffer,
  current: PurchaseSizeOffer
) {
  return (
    before.renewsAt === after.renewsAt &&
    before.card?.brand === after.card?.brand &&
    before.card?.last4 === after.card?.last4 &&
    offer.dueToday === current.dueToday &&
    offer.quote.amount === current.quote.amount &&
    offer.quote.priceId === current.quote.priceId &&
    offer.quote.currency === current.quote.currency &&
    offer.quote.interval === current.quote.interval &&
    offer.vcpus === current.vcpus &&
    offer.memoryGb === current.memoryGb &&
    offer.diskGb === current.diskGb
  );
}

export function createCheckout(
  adapter: CheckoutAdapter,
  publish: (state: CheckoutState) => void,
  newKey: () => string = () => crypto.randomUUID()
) {
  let review: { scope: Buyer; offers: PurchaseOffers } | undefined;
  let intent: Intent | undefined;
  let busy = false;
  let finished = false;

  async function load() {
    if (busy || intent || finished) return;
    busy = true;
    review = undefined;
    publish({ status: 'loading' });
    try {
      const scope = await adapter.readScope();
      if (scope.status !== 'signed-in' || !canBuy(scope)) {
        publish({
          status: scope.status === 'signed-in' ? 'denied' : scope.status,
        });
        return;
      }
      const result = await adapter.readOffers(scope);
      if (!sameScope(scope, await adapter.readScope())) {
        publish({ status: 'scope-changed' });
        return;
      }
      if (result.status !== 'quoted') {
        publish({ status: result.status });
        return;
      }
      review = { scope: Object.freeze({ ...scope }), offers: result.offers };
      publish({
        status: 'review',
        team: scope.teamName,
        offers: result.offers,
      });
    } catch {
      publish({ status: 'unavailable' });
    } finally {
      busy = false;
    }
  }

  async function send(confirmed: Intent, replay: boolean) {
    const result = await adapter.submit(confirmed);
    if (!sameScope(confirmed.scope, await adapter.readScope())) {
      publish({ status: 'scope-changed' });
      return;
    }
    if (result.status === 'accepted') {
      if (
        result.agent.teamId !== confirmed.scope.team ||
        !result.agent.computerId
      ) {
        publish({ status: 'unknown' });
        return;
      }
      finished = true;
      intent = undefined;
      publish(result);
      return;
    }
    if (
      !replay &&
      review &&
      (result.status === 'no-room' || result.status === 'declined')
    ) {
      const offers =
        result.status === 'no-room'
          ? {
              ...review.offers,
              sizes: review.offers.sizes.map((offer) =>
                offer.size === confirmed.request.size
                  ? { ...offer, soldOut: true }
                  : offer
              ),
            }
          : review.offers;
      review = { scope: review.scope, offers };
      intent = undefined;
      publish({
        status: 'review',
        team: review.scope.teamName,
        offers,
        notice: result.status,
      });
      return;
    }
    publish({ status: 'unknown' });
  }

  async function confirm(
    profile: HireProfile,
    size: PurchaseSizeOffer['size']
  ) {
    if (busy || intent || finished || !review) return;
    const { scope, offers } = review;
    const offer = offerFor(offers, size);
    if (!offer) return;
    const name = profile.name.trim();
    if (
      !name ||
      exceeds(name, 64) ||
      exceeds((profile.jobDescription ?? '').trim(), 4000) ||
      exceeds((profile.personality ?? '').trim(), 4000) ||
      (profile.avatarUrl && !profile.avatarUrl.startsWith('https://'))
    ) {
      publish({
        status: 'review',
        team: scope.teamName,
        offers,
        notice: 'invalid-profile',
      });
      return;
    }
    const body = {
      name,
      jobDescription: profile.jobDescription?.trim(),
      personality: profile.personality?.trim(),
      avatarUrl: profile.avatarUrl,
      voice: profile.voice,
      size,
    };
    busy = true;
    publish({ status: 'submitting' });
    try {
      if (!sameScope(scope, await adapter.readScope())) {
        review = undefined;
        publish({ status: 'scope-changed' });
        return;
      }
      const updated = await adapter.readOffers(scope);
      if (updated.status !== 'quoted') {
        review = undefined;
        publish({ status: updated.status });
        return;
      }
      if (!sameScope(scope, await adapter.readScope())) {
        review = undefined;
        publish({ status: 'scope-changed' });
        return;
      }
      const current = offerFor(updated.offers, size);
      review = { scope, offers: updated.offers };
      if (!current || !sameOffer(offers, updated.offers, offer, current)) {
        publish({
          status: 'review',
          team: scope.teamName,
          offers: updated.offers,
          notice: 'quote-changed',
        });
        return;
      }
      intent = {
        scope,
        request: Object.freeze({ ...body, purchaseKey: newKey() }),
      };
      await send(intent, false);
    } catch {
      publish({ status: intent ? 'unknown' : 'unavailable' });
    } finally {
      busy = false;
    }
  }

  async function retry() {
    if (busy || !intent) return;
    busy = true;
    publish({ status: 'submitting' });
    try {
      if (!sameScope(intent.scope, await adapter.readScope())) {
        publish({ status: 'scope-changed' });
        return;
      }
      await send(intent, true);
    } catch {
      publish({ status: 'unknown' });
    } finally {
      busy = false;
    }
  }

  return { load, confirm, retry };
}
