use std::sync::Mutex;

use super::*;
use crate::domain::{BillingError, Entitlement, PlanTier};

fn user(email: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email(email).unwrap()
}

struct FixedEntitlement(Entitlement);

impl EntitlementSource for FixedEntitlement {
    async fn entitlement(&self, _user: &MacroUserIdStr<'_>) -> Result<Entitlement> {
        Ok(self.0.clone())
    }

    async fn stripe_customer_id(&self, _user: &MacroUserIdStr<'_>) -> Result<Option<String>> {
        Ok(None)
    }

    async fn team_payer(&self, _team_id: Uuid) -> Result<Option<MacroUserIdStr<'static>>> {
        Ok(None)
    }
}

#[derive(Default)]
struct Books {
    grants: Mutex<Vec<(String, Uuid, u32)>>,
    bonuses: Mutex<Vec<(String, Uuid, i64)>>,
}

impl CreditGrantRepo for &'static Books {
    async fn record_credit_grant(
        &self,
        payer: &MacroUserIdStr<'_>,
        grant: &CreditGrant,
    ) -> Result<bool> {
        let mut grants = self.grants.lock().unwrap();
        if grants.iter().any(|(_, id, _)| *id == grant.id) {
            return Ok(false);
        }
        grants.push((payer.to_string(), grant.id, grant.amount_cents.get()));
        Ok(true)
    }

    async fn credit_grant_balance_cents(&self, _payer: &MacroUserIdStr<'_>) -> Result<i64> {
        Err(BillingError::Storage(anyhow::anyhow!("unused")))
    }
}

impl FreeAllowanceBonusRepo for &'static Books {
    async fn record_free_allowance_bonus(
        &self,
        user: &MacroUserIdStr<'_>,
        id: Uuid,
        cost_cents: i64,
        _note: &str,
    ) -> Result<bool> {
        let mut bonuses = self.bonuses.lock().unwrap();
        if bonuses.iter().any(|(_, existing, _)| *existing == id) {
            return Ok(false);
        }
        bonuses.push((user.to_string(), id, cost_cents));
        Ok(true)
    }
}

fn books() -> &'static Books {
    Box::leak(Box::default())
}

fn reward(beneficiary: &MacroUserIdStr<'static>, key: &str) -> InviteReward {
    InviteReward {
        beneficiary: beneficiary.clone(),
        event_key: key.to_owned(),
        note: "test".to_owned(),
    }
}

#[tokio::test]
async fn a_paid_inviter_gets_ten_dollars_of_credit_on_their_payer_once() {
    let member = user("member@acme.com");
    let owner = user("owner@acme.com");
    let mut entitlement = Entitlement::personal(owner.clone(), PlanTier::Premium);
    entitlement.billed_users.push(member.clone());
    let books = books();
    let service = InviteRewardService::new(FixedEntitlement(entitlement), books, books);

    let first = service
        .reward(&reward(&member, "team-invite:1"))
        .await
        .unwrap();
    let again = service
        .reward(&reward(&member, "team-invite:1"))
        .await
        .unwrap();

    assert_eq!(first, RewardOutcome::Credit);
    assert_eq!(again, RewardOutcome::Nothing);
    let grants = books.grants.lock().unwrap();
    assert_eq!(grants.len(), 1);
    assert_eq!(grants[0].0, owner.to_string());
    assert_eq!(grants[0].2, REWARD_CREDIT_CUSTOMER_CENTS);
    assert!(books.bonuses.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_free_inviter_gets_more_monthly_allowance() {
    let free = user("free@gmail.com");
    let books = books();
    let service = InviteRewardService::new(
        FixedEntitlement(Entitlement::personal(free.clone(), PlanTier::Free)),
        books,
        books,
    );

    let outcome = service.reward(&reward(&free, "referral:1")).await.unwrap();

    assert_eq!(outcome, RewardOutcome::FreeAllowance);
    let bonuses = books.bonuses.lock().unwrap();
    assert_eq!(bonuses.len(), 1);
    assert_eq!(bonuses[0].0, free.to_string());
    assert_eq!(bonuses[0].2, FREE_BONUS_COST_CENTS);
    assert!(books.grants.lock().unwrap().is_empty());
}

#[tokio::test]
async fn unlimited_plans_need_no_reward() {
    let enterprise = user("e@corp.com");
    let mut entitlement = Entitlement::personal(enterprise.clone(), PlanTier::Premium);
    entitlement.unlimited = true;
    let books = books();
    let service = InviteRewardService::new(FixedEntitlement(entitlement), books, books);

    let outcome = service.reward(&reward(&enterprise, "x")).await.unwrap();

    assert_eq!(outcome, RewardOutcome::Nothing);
    assert!(books.grants.lock().unwrap().is_empty());
    assert!(books.bonuses.lock().unwrap().is_empty());
}

#[test]
fn the_bonus_cap_is_fifty_dollars() {
    assert_eq!(capped_free_bonus_cents(-5), 0);
    assert_eq!(capped_free_bonus_cents(3_000), 3_000);
    assert_eq!(capped_free_bonus_cents(12_000), FREE_BONUS_CAP_COST_CENTS);
}
