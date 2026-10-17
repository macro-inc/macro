//! Who pays for a turn: the owner's Macro allowance, or their team's own
//! provider API key.
//!
//! A session starts on Macro usage. When the owner's allowance is spent and
//! their team has a key for the selected model's provider, a conversation
//! that has not started yet moves to the key on its own; one already under
//! way stops and asks, since the person may not want their team billed.
//! Agreeing (or choosing the key in the composer) sets the session's
//! [`Funding`] to [`Funding::TeamApiKey`], and every later turn runs on the key
//! without admission, so it never counts against the owner's allowance.

use ai_billing::domain::{AiAdmissionError, AiAdmissionService};
use model_owner::Owner;
use team_provider_keys::domain::{ModelProvider, TeamModelKeys, UsableProviderKey};

#[cfg(test)]
mod test;

/// ACP config option id for the session's [`Funding`].
pub const FUNDING_CONFIG_ID: &str = "funding";

/// What a session's turns run on.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum Funding {
    /// The owner's Macro AI allowance.
    #[default]
    Macro,
    /// The owner's team's own provider API key.
    TeamApiKey,
}

impl Funding {
    /// The config option value.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Macro => "macro",
            Self::TeamApiKey => "team_api_key",
        }
    }

    /// The funding a config option value names.
    #[must_use]
    pub fn parse(value: &str) -> Option<Self> {
        [Self::Macro, Self::TeamApiKey]
            .into_iter()
            .find(|funding| funding.as_str() == value)
    }
}

/// How one turn is paid for.
#[derive(Debug)]
pub enum TurnFunding {
    /// Admitted against the owner's allowance.
    Macro,
    /// On a team key the owner may use for the turn's model, decrypted for
    /// this turn only.
    TeamKey(UsableProviderKey),
}

/// Why a turn cannot run.
#[derive(Debug, PartialEq, Eq)]
pub enum FundingRefusal {
    /// Macro admission refused or failed, and no team key can take over.
    Admission(AiAdmissionError),
    /// The allowance is spent mid-conversation and a team key could carry
    /// on; the person decides.
    ContinueOnTeamKey,
    /// The session runs on the team key, but none the owner may use serves
    /// the turn's model.
    TeamKeyUnavailable,
}

/// Decide how a turn on `model` is paid for under the session's `funding`.
///
/// `conversation_started` is whether earlier turns ran: an allowance spent
/// before the first turn moves to a team key without asking, one spent
/// during a conversation does not.
pub async fn fund_turn(
    admission: &dyn AiAdmissionService,
    keys: &dyn TeamModelKeys,
    owner: &Owner,
    model: &str,
    funding: Funding,
    conversation_started: bool,
) -> Result<TurnFunding, FundingRefusal> {
    let user = owner
        .as_user()
        .ok_or(FundingRefusal::Admission(AiAdmissionError::Unavailable))?;
    let provider = ModelProvider::of_model(model);
    if funding == Funding::TeamApiKey {
        let provider = provider.ok_or(FundingRefusal::TeamKeyUnavailable)?;
        return match keys.usable_key(user, provider).await {
            Ok(Some(key)) => Ok(TurnFunding::TeamKey(key)),
            Ok(None) => Err(FundingRefusal::TeamKeyUnavailable),
            Err(error) => {
                tracing::error!(error = ?error, "could not read the team's provider key");
                Err(FundingRefusal::Admission(AiAdmissionError::Unavailable))
            }
        };
    }
    let denial = match super::admission::admit_turn(admission, owner).await {
        Ok(()) => return Ok(TurnFunding::Macro),
        Err(denial @ AiAdmissionError::Denied(_)) => denial,
        Err(error) => return Err(FundingRefusal::Admission(error)),
    };
    let Some(provider) = provider else {
        return Err(FundingRefusal::Admission(denial));
    };
    // A failed lookup leaves the denial standing: it is the answer the owner
    // would have had without team keys.
    let key = keys
        .usable_key(user, provider)
        .await
        .inspect_err(
            |error| tracing::error!(error = ?error, "could not read the team's provider key"),
        )
        .ok()
        .flatten();
    match key {
        None => Err(FundingRefusal::Admission(denial)),
        Some(key) if !conversation_started => Ok(TurnFunding::TeamKey(key)),
        Some(_) => Err(FundingRefusal::ContinueOnTeamKey),
    }
}
