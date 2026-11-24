//! Agent teammates' brains call the gateway with the agent's own Macro API
//! key under `/brain/anthropic/*`; usage counts against the agent account.

use std::{future::Future, pin::Pin, sync::Arc};

use agent_credentials::AgentCreators;
use computer_screen::domain::service::Hold;
use feature_flags::FeatureFlags;

use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use user_api_key::domain::{models::UserApiKey, ports::UserApiKeysRepo};
use user_api_key::outbound::pg_user_api_keys_repo::PgUserApiKeysRepo;
use uuid::Uuid;

/// An authenticated agent teammate.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct BrainCaller {
    /// The agent account the key belongs to.
    pub(crate) user_id: MacroUserIdStr<'static>,
    /// The agent's team.
    pub(crate) team_id: Uuid,
}

/// Why a brain could not be let through.
#[derive(Debug, thiserror::Error)]
pub(crate) enum BrainLookupError {
    /// The lookup failed.
    #[error("brain lookup failed: {0:?}")]
    Failed(rootcause::Report),
    /// A person still drives the agent's computer after the hold's bound;
    /// the brain retries after `retry_after`.
    #[error("a person is driving the agent's computer")]
    Held { retry_after: std::time::Duration },
}

impl From<rootcause::Report> for BrainLookupError {
    fn from(report: rootcause::Report) -> Self {
        Self::Failed(report)
    }
}

/// A boxed lookup, so the gateway can hold any authenticator.
pub(crate) type BrainLookup<'a> =
    Pin<Box<dyn Future<Output = Result<Option<BrainCaller>, BrainLookupError>> + Send + 'a>>;

/// Resolves a presented key to an agent teammate.
pub(crate) trait BrainAuthenticator: Send + Sync + 'static {
    /// The agent teammate a live key belongs to; `None` for any other key.
    fn authenticate<'a>(&'a self, key: &'a str) -> BrainLookup<'a>;
}

/// How long a brain request waits for a person to hand the agent's computer
/// back before it is answered 503 with `Retry-After`.
pub(crate) const HOLD_BOUND: std::time::Duration = std::time::Duration::from_secs(5 * 60);
/// What a held brain is told to wait before retrying.
pub(crate) const HELD_RETRY_AFTER: std::time::Duration = std::time::Duration::from_secs(10);

/// Holds every `/brain/*` request of an agent whose computer a person
/// drives: wraps the one authenticator all brain routes share, so a new
/// route built on it is held too. Keyed by the agent's user id.
/// A shutdown answers held requests at once, with the same `Retry-After`:
/// a deploy stops sooner than the hold's bound.
pub(crate) struct HeldBrains {
    inner: Arc<dyn BrainAuthenticator>,
    screens: Arc<crate::computers::screen::Screens>,
    shutdown: tokio_util::sync::CancellationToken,
}

impl HeldBrains {
    pub(crate) fn new(
        inner: Arc<dyn BrainAuthenticator>,
        screens: Arc<crate::computers::screen::Screens>,
        shutdown: tokio_util::sync::CancellationToken,
    ) -> Self {
        Self {
            inner,
            screens,
            shutdown,
        }
    }
}

impl BrainAuthenticator for HeldBrains {
    fn authenticate<'a>(&'a self, key: &'a str) -> BrainLookup<'a> {
        Box::pin(async move {
            let Some(caller) = self.inner.authenticate(key).await? else {
                return Ok(None);
            };
            let held = tokio::select! {
                held = self.screens.hold_agent(&caller.user_id, HOLD_BOUND) => held,
                () = self.shutdown.cancelled() => Ok(Hold::TimedOut),
            };
            match held.map_err(|error| rootcause::report!("{error:?}"))? {
                Hold::Free | Hold::Released { .. } => Ok(Some(caller)),
                Hold::TimedOut => Err(BrainLookupError::Held {
                    retry_after: HELD_RETRY_AFTER,
                }),
            }
        })
    }
}

type Evaluate =
    dyn Fn(MacroUserIdStr<'static>) -> Pin<Box<dyn Future<Output = bool> + Send>> + Send + Sync;

/// `enable-agent-teammates` for the agent's creator
/// ([`agent_credentials::rollout`]). No provider, no creator, a failed load
/// or the flag off all refuse the brain route.
#[derive(Clone, Default)]
pub(crate) struct BrainRollout {
    evaluate: Option<Arc<Evaluate>>,
}

impl BrainRollout {
    pub(crate) fn new<Creators, Flags>(creators: Creators, flags: Flags) -> Self
    where
        Creators: AgentCreators + 'static,
        Flags: FeatureFlags + 'static,
    {
        let creators = Arc::new(creators);
        let flags = Arc::new(flags);
        Self {
            evaluate: Some(Arc::new(move |agent| {
                let creators = Arc::clone(&creators);
                let flags = Arc::clone(&flags);
                Box::pin(async move {
                    agent_credentials::agent_teammates_enabled(
                        creators.as_ref(),
                        Some(flags.as_ref()),
                        &agent,
                    )
                    .await
                })
            })),
        }
    }

    pub(crate) async fn enabled(&self, agent: &MacroUserIdStr<'static>) -> bool {
        let Some(evaluate) = &self.evaluate else {
            return false;
        };
        evaluate(agent.clone()).await
    }
}

/// Keys from `user_api_key`, agents from `team_agents`.
pub(crate) struct PgBrainAuthenticator {
    pool: PgPool,
    keys: PgUserApiKeysRepo,
}

impl PgBrainAuthenticator {
    pub(crate) fn new(pool: PgPool) -> Self {
        Self {
            keys: PgUserApiKeysRepo::new(pool.clone()),
            pool,
        }
    }
}

impl BrainAuthenticator for PgBrainAuthenticator {
    fn authenticate<'a>(&'a self, key: &'a str) -> BrainLookup<'a> {
        Box::pin(async move {
            let Some(user_id) = self
                .keys
                .find_user_id_by_key(&UserApiKey::from_raw(key))
                .await
                .map_err(|error| rootcause::Report::new(error).into_dynamic())?
            else {
                return Ok(None);
            };
            let team_id = sqlx::query_scalar!(
                "SELECT team_id FROM team_agents WHERE user_id = $1",
                user_id.as_ref(),
            )
            .fetch_optional(&self.pool)
            .await
            .map_err(|error| rootcause::Report::new(error).into_dynamic())?;
            Ok(team_id.map(|team_id| BrainCaller { user_id, team_id }))
        })
    }
}

#[cfg(test)]
mod test;
