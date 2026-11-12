//! Agent teammates' brains call the gateway with the agent's own Macro API
//! key under `/brain/anthropic/*`; usage counts against the agent account.

use std::{future::Future, pin::Pin, sync::Arc};

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

/// A boxed lookup, so the gateway can hold any authenticator.
pub(crate) type BrainLookup<'a> =
    Pin<Box<dyn Future<Output = Result<Option<BrainCaller>, rootcause::Report>> + Send + 'a>>;

/// Resolves a presented key to an agent teammate.
pub(crate) trait BrainAuthenticator: Send + Sync + 'static {
    /// The agent teammate a live key belongs to; `None` for any other key.
    fn authenticate<'a>(&'a self, key: &'a str) -> BrainLookup<'a>;
}

type Evaluate =
    dyn Fn(MacroUserIdStr<'static>) -> Pin<Box<dyn Future<Output = bool> + Send>> + Send + Sync;

/// `enable-agent-teammates` for the agent's own account. No provider, a
/// failed load or the flag off all refuse the brain route.
#[derive(Clone, Default)]
pub(crate) struct BrainRollout {
    evaluate: Option<Arc<Evaluate>>,
}

impl BrainRollout {
    pub(crate) fn new<Flags: FeatureFlags + 'static>(flags: Flags) -> Self {
        let flags = Arc::new(flags);
        Self {
            evaluate: Some(Arc::new(move |user| {
                let flags = Arc::clone(&flags);
                Box::pin(async move {
                    flags
                        .load(&user)
                        .await
                        .inspect_err(|error| {
                            tracing::warn!(
                                ?error,
                                "agent teammates rollout unavailable; refusing the brain"
                            );
                        })
                        .unwrap_or_default()
                        .is_enabled(agent_credentials::AGENT_TEAMMATES_FLAG)
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
