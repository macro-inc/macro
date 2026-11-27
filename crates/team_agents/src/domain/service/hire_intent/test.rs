use std::{
    collections::HashMap,
    sync::{
        Mutex,
        atomic::{AtomicBool, AtomicI64, AtomicUsize, Ordering},
        mpsc::{Receiver, Sender, channel},
    },
    thread,
    time::Duration,
};

use entity_access::domain::models::{Entity, EntityPermission, TeamRole};
use hosted_runtimes::domain::models::{BillingInterval, Quote, SizeOffer};
use macro_user_id::cowlike::CowLike;

use super::*;
use crate::domain::models::ComputerSize;

const TEAM: Uuid = Uuid::from_u128(1);
const OTHER_TEAM: Uuid = Uuid::from_u128(2);

#[derive(Default)]
struct FakeAuthority(Mutex<HashMap<MacroUserIdStr<'static>, (Uuid, TeamRole)>>);

impl FakeAuthority {
    fn set(&self, user: &MacroUserIdStr<'static>, team: Uuid, role: TeamRole) {
        self.0.lock().unwrap().insert(user.clone(), (team, role));
    }
}

impl Authority for FakeAuthority {
    fn current(&self, actor: &MacroUserIdStr<'_>) -> Option<EntityAccessReceipt<AdminTeamRole>> {
        let grants = self.0.lock().unwrap();
        let actor = actor.clone().into_owned();
        let (team, role) = grants.get(&actor)?;
        EntityAccessReceipt::try_new_authenticated_user(
            actor,
            Entity {
                entity_id: team.to_string(),
                entity_type: EntityType::Team,
            },
            EntityPermission::TeamRole { role: *role },
        )
        .ok()
    }
}

struct Entry {
    receipt: Receipt,
    intent: Intent,
}

#[derive(Default)]
struct Book {
    offers: HashMap<OfferId, (Offer, bool)>,
    intents: HashMap<(Scope, PurchaseKey), Entry>,
}

#[derive(Default)]
struct FakeStore {
    book: Mutex<Book>,
    fail_record: AtomicBool,
}

impl Store for FakeStore {
    fn issue(&self, offer: Offer) {
        assert!(
            self.book
                .lock()
                .unwrap()
                .offers
                .insert(offer.id, (offer, false))
                .is_none()
        );
    }

    fn claim(
        &self,
        buyer: &Buyer,
        intent: &Intent,
        now: DateTime<Utc>,
    ) -> Result<Claim, CheckoutError> {
        let mut book = self.book.lock().unwrap();
        let key = (buyer.0.clone(), intent.invite.purchase_key.clone());
        if let Some(entry) = book.intents.get(&key) {
            return if entry.intent.same_request(intent) {
                Ok(Claim::Replay(entry.receipt.clone()))
            } else {
                Err(CheckoutError::Conflict)
            };
        }
        let (offer, consumed) = book
            .offers
            .get_mut(&intent.offer)
            .ok_or(CheckoutError::Scope)?;
        if offer.scope != buyer.0 {
            return Err(CheckoutError::Scope);
        }
        if offer.expires_at <= now {
            return Err(CheckoutError::Expired);
        }
        if offer.terms.offer.size != intent.invite.size {
            return Err(CheckoutError::Invalid);
        }
        if *consumed {
            return Err(CheckoutError::Conflict);
        }
        *consumed = true;
        let offer = offer.clone();
        let receipt = Receipt {
            id: ReceiptId(Uuid::now_v7()),
            outcome: Outcome::Pending,
        };
        let downstream_key = PurchaseKey::try_new(format!("hire:{}", receipt.id.0)).unwrap();
        book.intents.insert(
            key,
            Entry {
                receipt: receipt.clone(),
                intent: Intent {
                    offer: intent.offer,
                    invite: intent.invite.clone(),
                },
            },
        );
        Ok(Claim::Dispatch(Box::new(Dispatch {
            receipt,
            downstream_key,
            offer,
        })))
    }

    fn read(&self, buyer: &Buyer, key: &PurchaseKey) -> Option<Receipt> {
        self.book
            .lock()
            .unwrap()
            .intents
            .get(&(buyer.0.clone(), key.clone()))
            .map(|entry| entry.receipt.clone())
    }

    fn record(
        &self,
        buyer: &Buyer,
        receipt: ReceiptId,
        evidence: CommerceEvidence,
    ) -> Option<Receipt> {
        if self.fail_record.swap(false, Ordering::SeqCst) {
            return None;
        }
        let mut book = self.book.lock().unwrap();
        let (_, entry) = book
            .intents
            .iter_mut()
            .find(|((scope, _), entry)| scope == &buyer.0 && entry.receipt.id == receipt)?;
        entry.receipt.outcome = entry.receipt.outcome.observe(evidence);
        Some(entry.receipt.clone())
    }
}

struct FakeCommerce {
    quotes: AtomicUsize,
    sends: AtomicUsize,
    result: Mutex<CommerceEvidence>,
    observed: Mutex<Option<(ReceiptId, CommerceEvidence)>>,
    pause: Option<(Sender<()>, Mutex<Receiver<()>>)>,
}

impl Default for FakeCommerce {
    fn default() -> Self {
        Self {
            quotes: AtomicUsize::new(0),
            sends: AtomicUsize::new(0),
            result: Mutex::new(CommerceEvidence::Unknown),
            observed: Mutex::new(None),
            pause: None,
        }
    }
}

impl Commerce for FakeCommerce {
    fn quote(&self, _: &Buyer) -> Option<PurchaseSizeOffer> {
        self.quotes.fetch_add(1, Ordering::SeqCst);
        Some(PurchaseSizeOffer {
            offer: SizeOffer {
                size: ComputerSize::Standard,
                vcpus: 2,
                memory_gb: 4,
                disk_gb: 32,
                quote: Quote {
                    size: ComputerSize::Standard,
                    price_id: "price_fixture".parse().unwrap(),
                    amount: 1900,
                    currency: "usd".to_owned(),
                    interval: BillingInterval::Month,
                },
                sold_out: false,
            },
            due_today: 700,
        })
    }

    fn dispatch(&self, dispatch: &Dispatch, intent: TeamAgentInvite) -> CommerceEvidence {
        self.sends.fetch_add(1, Ordering::SeqCst);
        assert_eq!(
            intent.purchase_key.as_str(),
            format!("hire:{}", dispatch.receipt.id.0)
        );
        assert_eq!(dispatch.offer.terms.offer.size, intent.size);
        if let Some((entered, release)) = &self.pause {
            entered.send(()).unwrap();
            release
                .lock()
                .unwrap()
                .recv_timeout(Duration::from_secs(5))
                .unwrap();
        }
        std::mem::replace(&mut *self.result.lock().unwrap(), CommerceEvidence::Unknown)
    }

    fn observe(&self, receipt: ReceiptId) -> Option<CommerceEvidence> {
        let mut observed = self.observed.lock().unwrap();
        if observed.as_ref().is_some_and(|(id, _)| *id == receipt) {
            return observed.take().map(|(_, evidence)| evidence);
        }
        None
    }
}

fn checkout(
    now: &AtomicI64,
    commerce: FakeCommerce,
) -> Checkout<FakeAuthority, FakeStore, FakeCommerce, impl Fn() -> DateTime<Utc> + '_> {
    Checkout {
        access: FakeAuthority::default(),
        store: FakeStore::default(),
        commerce,
        now: || DateTime::from_timestamp(now.load(Ordering::SeqCst), 0).unwrap(),
        offer_lifetime: TimeDelta::seconds(30),
    }
}

fn buyer() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("buyer@example.invalid").unwrap()
}

fn request(key: &str, name: &str) -> CreateTeamAgent {
    CreateTeamAgent {
        purchase_key: key.to_owned(),
        name: name.to_owned(),
        job_description: String::new(),
        personality: String::new(),
        size: ComputerSize::Standard,
        avatar_url: None,
        voice: None,
    }
}

#[test]
fn authorization_denies_unverified_buyer_team_and_foreign_offer_before_dispatch() {
    let now = AtomicI64::new(0);
    let checkout = checkout(&now, FakeCommerce::default());
    let actor = buyer();
    let other = MacroUserIdStr::try_from_email("other@example.invalid").unwrap();
    assert!(matches!(
        checkout.quote(&actor, TEAM),
        Err(CheckoutError::Scope)
    ));
    checkout.access.set(&actor, TEAM, TeamRole::Member);
    assert!(matches!(
        checkout.quote(&actor, TEAM),
        Err(CheckoutError::Scope)
    ));
    checkout.access.set(&actor, TEAM, TeamRole::Admin);
    assert!(matches!(
        checkout.quote(&actor, OTHER_TEAM),
        Err(CheckoutError::Scope)
    ));
    assert_eq!(checkout.commerce.quotes.load(Ordering::SeqCst), 0);
    let offer = checkout.quote(&actor, TEAM).unwrap();
    checkout.access.set(&other, TEAM, TeamRole::Owner);
    assert_eq!(
        checkout.confirm(&other, TEAM, offer.id, request("one", "Sample")),
        Err(CheckoutError::Scope)
    );
    checkout.access.set(&actor, OTHER_TEAM, TeamRole::Owner);
    assert_eq!(
        checkout.confirm(&actor, TEAM, offer.id, request("one", "Sample")),
        Err(CheckoutError::Scope)
    );
    assert_eq!(
        checkout.confirm(&actor, OTHER_TEAM, offer.id, request("one", "Sample")),
        Err(CheckoutError::Scope)
    );
    assert_eq!(checkout.commerce.sends.load(Ordering::SeqCst), 0);
}

#[test]
fn expired_offer_and_wrong_size_do_not_create_an_intent() {
    let now = AtomicI64::new(0);
    let checkout = checkout(&now, FakeCommerce::default());
    let actor = buyer();
    checkout.access.set(&actor, TEAM, TeamRole::Owner);
    let offer = checkout.quote(&actor, TEAM).unwrap();
    let mut wrong_size = request("one", "Sample");
    wrong_size.size = ComputerSize::Large;
    assert_eq!(
        checkout.confirm(&actor, TEAM, offer.id, wrong_size),
        Err(CheckoutError::Invalid)
    );
    now.store(30, Ordering::SeqCst);
    assert_eq!(
        checkout.confirm(&actor, TEAM, offer.id, request("one", "Sample")),
        Err(CheckoutError::Expired)
    );
    assert!(checkout.store.book.lock().unwrap().intents.is_empty());
    assert_eq!(checkout.commerce.sends.load(Ordering::SeqCst), 0);
}

#[test]
fn parallel_and_expired_replays_observe_one_immutable_intent() {
    let now = AtomicI64::new(0);
    let (entered, dispatched) = channel();
    let (release, released) = channel();
    let checkout = checkout(
        &now,
        FakeCommerce {
            pause: Some((entered, Mutex::new(released))),
            result: Mutex::new(CommerceEvidence::RefusedNoCharge),
            ..FakeCommerce::default()
        },
    );
    let actor = buyer();
    checkout.access.set(&actor, TEAM, TeamRole::Owner);
    let offer = checkout.quote(&actor, TEAM).unwrap();
    let receipt = thread::scope(|threads| {
        let first = threads
            .spawn(|| checkout.confirm(&actor, TEAM, offer.id, request("one", "  Sample  ")));
        dispatched.recv_timeout(Duration::from_secs(5)).unwrap();
        now.store(30, Ordering::SeqCst);
        let duplicate = checkout.confirm(&actor, TEAM, offer.id, request("one", "Sample"));
        let changed = checkout.confirm(&actor, TEAM, offer.id, request("one", "Different"));
        release.send(()).unwrap();
        let final_receipt = first.join().unwrap().unwrap();
        assert_eq!(
            duplicate.unwrap(),
            Receipt {
                id: final_receipt.id,
                outcome: Outcome::Pending
            }
        );
        assert_eq!(changed, Err(CheckoutError::Conflict));
        final_receipt
    });
    assert_eq!(receipt.outcome, Outcome::RefusedNoCharge);
    assert_eq!(
        checkout.confirm(&actor, TEAM, offer.id, request("one", "Sample")),
        Ok(receipt)
    );
    assert_eq!(checkout.commerce.sends.load(Ordering::SeqCst), 1);
}

#[test]
fn a_consumed_offer_cannot_authorize_a_second_purchase_key() {
    let now = AtomicI64::new(0);
    let checkout = checkout(&now, FakeCommerce::default());
    let actor = buyer();
    checkout.access.set(&actor, TEAM, TeamRole::Owner);
    let offer = checkout.quote(&actor, TEAM).unwrap();
    assert_eq!(
        checkout
            .confirm(&actor, TEAM, offer.id, request("one", "Sample"))
            .unwrap()
            .outcome,
        Outcome::Unknown
    );
    assert_eq!(
        checkout.confirm(&actor, TEAM, offer.id, request("two", "Sample")),
        Err(CheckoutError::Conflict)
    );
    assert_eq!(checkout.commerce.sends.load(Ordering::SeqCst), 1);
}

#[test]
fn ambiguous_dispatch_requires_positive_scoped_evidence_and_never_repeats() {
    let now = AtomicI64::new(0);
    let checkout = checkout(&now, FakeCommerce::default());
    let actor = buyer();
    checkout.access.set(&actor, TEAM, TeamRole::Owner);
    let offer = checkout.quote(&actor, TEAM).unwrap();
    let key = PurchaseKey::try_new("one".to_owned()).unwrap();
    let initial = checkout
        .confirm(&actor, TEAM, offer.id, request(key.as_str(), "Sample"))
        .unwrap();
    assert_eq!(initial.outcome, Outcome::Unknown);
    assert_eq!(checkout.reconcile(&actor, TEAM, &key), Ok(initial.clone()));
    checkout.access.set(&actor, TEAM, TeamRole::Member);
    assert_eq!(checkout.read(&actor, TEAM, &key), Err(CheckoutError::Scope));
    assert_eq!(
        checkout.reconcile(&actor, TEAM, &key),
        Err(CheckoutError::Scope)
    );
    checkout.access.set(&actor, TEAM, TeamRole::Owner);
    let computer = ComputerId::new_from_uuid(Uuid::from_u128(3));
    *checkout.commerce.observed.lock().unwrap() = Some((
        ReceiptId(Uuid::from_u128(99)),
        CommerceEvidence::Purchase(Purchase::Ready(computer)),
    ));
    assert_eq!(checkout.reconcile(&actor, TEAM, &key), Ok(initial.clone()));
    *checkout.commerce.observed.lock().unwrap() = Some((
        initial.id,
        CommerceEvidence::Purchase(Purchase::Confirming(computer)),
    ));
    assert_eq!(
        checkout.reconcile(&actor, TEAM, &key).unwrap().outcome,
        Outcome::Confirming(computer)
    );
    let other = ComputerId::new_from_uuid(Uuid::from_u128(4));
    *checkout.commerce.observed.lock().unwrap() = Some((
        initial.id,
        CommerceEvidence::Purchase(Purchase::Ready(other)),
    ));
    assert_eq!(
        checkout.reconcile(&actor, TEAM, &key).unwrap().outcome,
        Outcome::Confirming(computer)
    );
    *checkout.commerce.observed.lock().unwrap() = Some((
        initial.id,
        CommerceEvidence::Purchase(Purchase::Ready(computer)),
    ));
    let final_receipt = checkout.reconcile(&actor, TEAM, &key).unwrap();
    assert_eq!(
        final_receipt,
        Receipt {
            id: initial.id,
            outcome: Outcome::Confirmed(computer)
        }
    );
    *checkout.commerce.observed.lock().unwrap() =
        Some((initial.id, CommerceEvidence::RefusedNoCharge));
    assert_eq!(checkout.reconcile(&actor, TEAM, &key), Ok(final_receipt));
    assert_eq!(checkout.commerce.sends.load(Ordering::SeqCst), 1);
}

#[test]
fn lost_outcome_write_keeps_the_pending_receipt_for_replay_without_dispatch() {
    let now = AtomicI64::new(0);
    let checkout = checkout(&now, FakeCommerce::default());
    let actor = buyer();
    checkout.access.set(&actor, TEAM, TeamRole::Owner);
    let offer = checkout.quote(&actor, TEAM).unwrap();
    let key = PurchaseKey::try_new("one".to_owned()).unwrap();
    checkout.store.fail_record.store(true, Ordering::SeqCst);
    let response = checkout.confirm(&actor, TEAM, offer.id, request(key.as_str(), "Sample"));
    let receipt = checkout.read(&actor, TEAM, &key).unwrap();
    assert_eq!(response, Err(CheckoutError::Unconfirmed(receipt.id)));
    assert_eq!(receipt.outcome, Outcome::Pending);
    assert_eq!(
        checkout.confirm(&actor, TEAM, offer.id, request(key.as_str(), "Sample")),
        Ok(receipt)
    );
    assert_eq!(checkout.commerce.sends.load(Ordering::SeqCst), 1);
}
