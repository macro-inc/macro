//! Unmounted checkout protocol exercised only by the local proof.

use chrono::{DateTime, TimeDelta, Utc};
use entity_access::domain::models::EntityType;
use hosted_runtimes::domain::models::{Purchase, PurchaseSizeOffer};

use super::{
    AdminTeamRole, ComputerId, CreateTeamAgent, EntityAccessReceipt, MacroUserIdStr, PurchaseKey,
    TeamAgentInvite, Uuid, acting_user, team_id, validate,
};

mod test;

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct Scope {
    actor: MacroUserIdStr<'static>,
    team: Uuid,
}

struct Buyer(Scope);

trait Authority {
    // Carries current human/admin authority and rollout. An authenticated
    // principal alone is insufficient.
    fn current(&self, actor: &MacroUserIdStr<'_>) -> Option<EntityAccessReceipt<AdminTeamRole>>;
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
struct OfferId(Uuid);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ReceiptId(Uuid);

#[derive(Clone)]
struct Offer {
    id: OfferId,
    scope: Scope,
    terms: PurchaseSizeOffer,
    expires_at: DateTime<Utc>,
}

struct Intent {
    offer: OfferId,
    invite: TeamAgentInvite,
}

impl Intent {
    fn same_request(&self, other: &Self) -> bool {
        self.offer == other.offer
            && self.invite.purchase_key == other.invite.purchase_key
            && self.invite.size == other.invite.size
            && self.invite.name == other.invite.name
            && self.invite.job_description == other.invite.job_description
            && self.invite.personality == other.invite.personality
            && self.invite.avatar_url == other.invite.avatar_url
            && self.invite.voice == other.invite.voice
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Outcome {
    Pending,
    Unknown,
    Confirming(ComputerId),
    Confirmed(ComputerId),
    RefusedNoCharge,
}

enum CommerceEvidence {
    Purchase(Purchase),
    RefusedNoCharge,
    Unknown,
}

impl Outcome {
    fn observe(self, evidence: CommerceEvidence) -> Self {
        if matches!(self, Self::Confirmed(_) | Self::RefusedNoCharge) {
            return self;
        }
        match evidence {
            CommerceEvidence::Purchase(purchase) => {
                if let Self::Confirming(computer) = self
                    && computer != purchase.computer_id()
                {
                    return self;
                }
                match purchase {
                    Purchase::Ready(id) => Self::Confirmed(id),
                    Purchase::Confirming(id) => Self::Confirming(id),
                }
            }
            CommerceEvidence::RefusedNoCharge => Self::RefusedNoCharge,
            CommerceEvidence::Unknown if self == Self::Pending => Self::Unknown,
            CommerceEvidence::Unknown => self,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Receipt {
    id: ReceiptId,
    outcome: Outcome,
}

struct Dispatch {
    receipt: Receipt,
    downstream_key: PurchaseKey,
    offer: Offer,
}

enum Claim {
    Dispatch(Box<Dispatch>),
    Replay(Receipt),
}

#[derive(Debug, PartialEq, Eq)]
enum CheckoutError {
    Scope,
    Unavailable,
    Unconfirmed(ReceiptId),
    Invalid,
    Expired,
    Conflict,
}

trait Store {
    fn issue(&self, offer: Offer);
    // A successful claim consumes the offer and commits a pending receipt in
    // the same transaction. Identical replay reads that receipt, even after
    // offer expiry. The caller cannot manufacture a Dispatch.
    fn claim(
        &self,
        buyer: &Buyer,
        intent: &Intent,
        now: DateTime<Utc>,
    ) -> Result<Claim, CheckoutError>;
    fn read(&self, buyer: &Buyer, key: &PurchaseKey) -> Option<Receipt>;
    fn record(
        &self,
        buyer: &Buyer,
        receipt: ReceiptId,
        evidence: CommerceEvidence,
    ) -> Option<Receipt>;
}

trait Commerce {
    fn quote(&self, buyer: &Buyer) -> Option<PurchaseSizeOffer>;
    fn dispatch(&self, dispatch: &Dispatch, intent: TeamAgentInvite) -> CommerceEvidence;
    // The adapter verifies this evidence belongs to this receipt and its
    // downstream operation. A missing row is not a definite refusal.
    fn observe(&self, receipt: ReceiptId) -> Option<CommerceEvidence>;
}

struct Checkout<Access, Book, Engine, Clock> {
    access: Access,
    store: Book,
    commerce: Engine,
    now: Clock,
    offer_lifetime: TimeDelta,
}

impl<Access: Authority, Book: Store, Engine: Commerce, Clock: Fn() -> DateTime<Utc>>
    Checkout<Access, Book, Engine, Clock>
{
    fn authorize(
        &self,
        actor: &MacroUserIdStr<'_>,
        expected_team: Uuid,
    ) -> Result<Buyer, CheckoutError> {
        let receipt = self.access.current(actor).ok_or(CheckoutError::Scope)?;
        let team = team_id(&receipt).map_err(|_| CheckoutError::Scope)?;
        let user = acting_user(&receipt).map_err(|_| CheckoutError::Scope)?;
        if receipt.entity().entity_type != EntityType::Team
            || team != expected_team
            || &user != actor
        {
            return Err(CheckoutError::Scope);
        }
        Ok(Buyer(Scope { actor: user, team }))
    }

    fn quote(
        &self,
        actor: &MacroUserIdStr<'_>,
        expected_team: Uuid,
    ) -> Result<Offer, CheckoutError> {
        let buyer = self.authorize(actor, expected_team)?;
        let terms = self
            .commerce
            .quote(&buyer)
            .ok_or(CheckoutError::Unavailable)?;
        if terms.offer.sold_out {
            return Err(CheckoutError::Unavailable);
        }
        let offer = Offer {
            id: OfferId(Uuid::now_v7()),
            scope: buyer.0,
            terms,
            expires_at: (self.now)() + self.offer_lifetime,
        };
        self.store.issue(offer.clone());
        Ok(offer)
    }

    fn confirm(
        &self,
        actor: &MacroUserIdStr<'_>,
        expected_team: Uuid,
        offer: OfferId,
        requested: CreateTeamAgent,
    ) -> Result<Receipt, CheckoutError> {
        let buyer = self.authorize(actor, expected_team)?;
        let invite = validate(requested).map_err(|_| CheckoutError::Invalid)?;
        let intent = Intent { offer, invite };
        match self.store.claim(&buyer, &intent, (self.now)())? {
            Claim::Replay(receipt) => Ok(receipt),
            Claim::Dispatch(dispatch) => {
                let mut invite = intent.invite;
                invite.purchase_key = dispatch.downstream_key.clone();
                let evidence = self.commerce.dispatch(&dispatch, invite);
                self.store
                    .record(&buyer, dispatch.receipt.id, evidence)
                    .ok_or(CheckoutError::Unconfirmed(dispatch.receipt.id))
            }
        }
    }

    fn read(
        &self,
        actor: &MacroUserIdStr<'_>,
        expected_team: Uuid,
        key: &PurchaseKey,
    ) -> Result<Receipt, CheckoutError> {
        let buyer = self.authorize(actor, expected_team)?;
        self.store.read(&buyer, key).ok_or(CheckoutError::Scope)
    }

    fn reconcile(
        &self,
        actor: &MacroUserIdStr<'_>,
        expected_team: Uuid,
        key: &PurchaseKey,
    ) -> Result<Receipt, CheckoutError> {
        let buyer = self.authorize(actor, expected_team)?;
        let receipt = self.store.read(&buyer, key).ok_or(CheckoutError::Scope)?;
        let Some(evidence) = self.commerce.observe(receipt.id) else {
            return Ok(receipt);
        };
        self.store
            .record(&buyer, receipt.id, evidence)
            .ok_or(CheckoutError::Unconfirmed(receipt.id))
    }
}
