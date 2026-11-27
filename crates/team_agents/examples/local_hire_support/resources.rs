//! Provider-free ports for the disposable Hire review process.

use std::io;

use chrono::{DateTime, Utc};
use hosted_runtimes::domain::{
    lifecycle::PurchaseRefund,
    models::{PurchaseBilling, PurchaseTerms, Quote, SubscriptionItem},
    ports::{Billing, BillingError, ChargeStatus, CompPolicy, ItemCharge},
    rollout::ENABLE_MACRO_COMPUTERS,
    size::ComputerSize,
};
use stripe::{PriceId, SubscriptionItemId};

use agent_credentials::AgentCreators;
use feature_flags::{FeatureFlags, FlagSnapshot, FlagValue};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use team_agents::domain::{
    models::{
        AgentApiKey, AgentReady, AgentRepo, ComputerId, PersonaSeed, RepoToken, TeamAgentError,
        VoiceModel,
    },
    ports::{AgentApiKeys, AgentReadyNotices, AgentRepos, EnrollmentEnvironment},
    service::AGENT_TEAMMATES_FLAG,
};
use uuid::Uuid;

pub struct LocalOnly(pub MacroUserIdStr<'static>);

impl FeatureFlags for LocalOnly {
    async fn load(&self, actor: &MacroUserIdStr<'_>) -> Result<FlagSnapshot, Report> {
        let enabled = FlagValue::Boolean(self.0.as_ref() == actor.as_ref());
        Ok(FlagSnapshot::new([
            (AGENT_TEAMMATES_FLAG.to_owned(), enabled.clone()),
            (ENABLE_MACRO_COMPUTERS.to_owned(), enabled),
        ]))
    }
}

pub struct Unwired;

impl AgentCreators for Unwired {
    async fn creator_of(
        &self,
        _: &MacroUserIdStr<'_>,
    ) -> Result<Option<MacroUserIdStr<'static>>, Report> {
        Ok(None)
    }
}

impl AgentApiKeys for Unwired {
    async fn revoke_all(&self, _: &MacroUserIdStr<'_>) -> Result<(), TeamAgentError> {
        Ok(())
    }

    async fn mint(&self, _: &MacroUserIdStr<'_>) -> Result<AgentApiKey, TeamAgentError> {
        Err(TeamAgentError::NotEnabled)
    }
}

impl AgentRepos for Unwired {
    async fn create(
        &self,
        _: &MacroUserIdStr<'_>,
        _: Uuid,
        _: &PersonaSeed,
    ) -> Result<AgentRepo, TeamAgentError> {
        // create() only checks that the workspace port succeeds. No endpoint
        // receives or accepts this private, unused token.
        Ok(AgentRepo {
            url: "https://local-hire-review.invalid/".to_owned(),
            token: RepoToken::generate(),
        })
    }

    async fn delete(&self, _: &MacroUserIdStr<'_>) -> Result<(), TeamAgentError> {
        Ok(())
    }

    async fn voice(
        &self,
        _: &MacroUserIdStr<'_>,
        _: Uuid,
    ) -> Result<Option<VoiceModel>, TeamAgentError> {
        Ok(None)
    }

    async fn set_voice(
        &self,
        _: &MacroUserIdStr<'_>,
        _: Uuid,
        _: &VoiceModel,
    ) -> Result<(), TeamAgentError> {
        Err(TeamAgentError::NotEnabled)
    }
}

impl AgentReadyNotices for Unwired {
    async fn send(&self, _: AgentReady) -> Result<(), TeamAgentError> {
        Err(TeamAgentError::NotEnabled)
    }
}

impl EnrollmentEnvironment for Unwired {
    fn environment(&self) -> Result<Vec<(&'static str, String)>, TeamAgentError> {
        Err(TeamAgentError::NotEnabled)
    }
}

/// The local composition admits one seeded team and has no paid fallback.
pub struct LocalComp(pub Uuid);

impl CompPolicy for LocalComp {
    type Err = io::Error;

    async fn comp_reason(&self, team: Uuid) -> Result<Option<String>, Self::Err> {
        if team != self.0 {
            return Err(io::Error::other("team outside local review"));
        }
        Ok(Some("Disposable local Hire review".to_owned()))
    }
}

/// This type has no credentials, clients or network implementation. Any
/// unexpected attempt to enter a billing operation aborts the review.
pub struct DisabledBilling;

impl Billing for DisabledBilling {
    fn sales_available(&self) -> bool {
        true
    }

    async fn quote(&self, _: Uuid, _: ComputerSize) -> Result<Quote, BillingError> {
        unreachable!("local Hire must not lookup prices")
    }

    async fn purchase_terms(
        &self,
        _: Uuid,
        _: &[ComputerSize],
        _: &PurchaseBilling,
    ) -> Result<PurchaseTerms, BillingError> {
        unreachable!("local Hire must not lookup payment terms")
    }

    async fn purchase_price(&self, _: Uuid, _: ComputerSize) -> Result<PriceId, BillingError> {
        unreachable!("local Hire must not lookup purchase prices")
    }

    async fn add_computer(
        &self,
        _: Uuid,
        _: ComputerId,
        _: &PriceId,
        _: &[SubscriptionItem],
        _: ItemCharge,
        _: &str,
    ) -> Result<SubscriptionItemId, BillingError> {
        unreachable!("local Hire must not add billed computers")
    }

    async fn settle_computer_add(
        &self,
        _: Uuid,
        _: ComputerId,
        _: &str,
    ) -> Result<Option<SubscriptionItemId>, BillingError> {
        unreachable!("local Hire must not settle billed computers")
    }

    async fn charge_status(&self, _: &str) -> Result<Option<ChargeStatus>, BillingError> {
        unreachable!("local Hire must not lookup charges")
    }

    async fn computer_item(
        &self,
        _: Uuid,
        _: ComputerId,
    ) -> Result<Option<SubscriptionItemId>, BillingError> {
        unreachable!("local Hire must not lookup subscription items")
    }

    async fn remove_computer(
        &self,
        _: Uuid,
        _: &SubscriptionItemId,
        _: &str,
    ) -> Result<(), BillingError> {
        unreachable!("local Hire must not remove billed computers")
    }

    async fn refund_computer_purchase(
        &self,
        _: Uuid,
        _: ComputerId,
        _: &str,
    ) -> Result<Option<PurchaseRefund>, BillingError> {
        unreachable!("local Hire must not refund a purchase")
    }

    async fn require_paid_plan(&self, _: Uuid) -> Result<(), BillingError> {
        unreachable!("local Hire must not lookup paid plans")
    }

    async fn period_end(&self, _: Uuid) -> Result<DateTime<Utc>, BillingError> {
        unreachable!("local Hire must not lookup billing periods")
    }
}
