//! The screen's ports onto the rest of the harness: who may use a
//! harness's screen ([`HarnessScreenAccess`], the same checks as Claude
//! sign-in) and who people are ([`MacroPeople`], from the accounts the
//! user tables' crate reads).

use std::sync::Arc;

use computer_screen::domain::models::{Access, Mode, Person};
use computer_screen::domain::ports::{People, ScreenAccess};
use harness_id::HarnessId;
use harnesses::domain::models::HarnessPermission;
use harnesses::domain::ports::{HarnessError, HarnessService};
use harnesses::domain::service::HarnessServiceImpl;
use harnesses::outbound::pg_harness_repo::PgHarnessRepo;
use hosted_runtimes::domain::agent::ComputerAgents as _;
use hosted_runtimes::domain::ids::ComputerId;
use hosted_runtimes::domain::rollout::ComputerRollout;
use hosted_runtimes::outbound::pg::PgComputerAgents;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;

/// A lookup behind a screen port failed, and which one.
#[derive(Debug, thiserror::Error)]
pub enum LookupError {
    /// Reading the harness or its permissions.
    #[error("the harness lookup failed")]
    Harness(rootcause::Report),
    /// Reading which agent the computer runs.
    #[error("the computer's agent lookup failed")]
    Agent(rootcause::Report),
    /// Reading the account.
    #[error("the account lookup failed")]
    Account(rootcause::Report),
}

/// The permission a screen mode needs: watching is `View`, driving is
/// `Manage` (the team's owner and admins on a computer).
pub fn permission_for(mode: Mode) -> HarnessPermission {
    match mode {
        Mode::View => HarnessPermission::View,
        Mode::Drive => HarnessPermission::Manage,
    }
}

/// [`ScreenAccess`] through the harness service, the computer rollout and
/// the computer's agent.
pub struct HarnessScreenAccess {
    harnesses: Arc<HarnessServiceImpl<PgHarnessRepo, PgComputerAgents>>,
    rollout: ComputerRollout,
    agents: PgComputerAgents,
}

impl HarnessScreenAccess {
    /// Check through these.
    pub fn new(
        harnesses: Arc<HarnessServiceImpl<PgHarnessRepo, PgComputerAgents>>,
        rollout: ComputerRollout,
        agents: PgComputerAgents,
    ) -> Self {
        Self {
            harnesses,
            rollout,
            agents,
        }
    }
}

impl ScreenAccess for HarnessScreenAccess {
    type Err = LookupError;

    async fn rollout(&self, user: &MacroUserIdStr<'static>) -> bool {
        self.rollout.enabled(user).await
    }

    async fn authorize(
        &self,
        user: &MacroUserIdStr<'static>,
        harness: HarnessId,
        mode: Mode,
    ) -> Result<Access, LookupError> {
        match self
            .harnesses
            .authorize_harness(user.clone(), harness, permission_for(mode))
            .await
        {
            Ok(harness) => Ok(harness
                .computer_id
                .map_or(Access::NotAComputer, Access::Granted)),
            Err(HarnessError::NotFound(_)) => Ok(Access::NotFound),
            Err(HarnessError::Repo(error)) => {
                Err(LookupError::Harness(rootcause::report!("{error:?}")))
            }
            Err(
                HarnessError::Unauthorized
                | HarnessError::BadRequest(_)
                | HarnessError::Gone(_)
                | HarnessError::Throttled
                | HarnessError::ComputerHarness,
            ) => Ok(Access::Denied),
        }
    }

    async fn agent_of(
        &self,
        computer: ComputerId,
    ) -> Result<Option<MacroUserIdStr<'static>>, LookupError> {
        self.agents
            .agent_of(computer)
            .await
            .map_err(|error| LookupError::Agent(rootcause::report!("{error}")))
    }
}

/// [`People`] from the `User` and `macro_user_info` rows, through
/// `macro_db_client`'s user queries.
pub struct MacroPeople {
    pool: PgPool,
}

impl MacroPeople {
    /// Read through `pool`.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl People for MacroPeople {
    type Err = LookupError;

    async fn person(&self, user: &MacroUserIdStr<'_>) -> Result<Option<Person>, LookupError> {
        let account =
            match macro_db_client::user::get::get_legacy_user_info(&self.pool, &user.0).await {
                Ok(account) => account,
                Err(error)
                    if matches!(
                        error.downcast_ref::<sqlx::Error>(),
                        Some(sqlx::Error::RowNotFound)
                    ) =>
                {
                    return Ok(None);
                }
                Err(error) => return Err(LookupError::Account(rootcause::report!("{error:#}"))),
            };
        let names = macro_db_client::user::get_user_name::get_user_names(
            &self.pool,
            &vec![user.as_ref().to_owned()],
        )
        .await
        .map_err(|error| LookupError::Account(rootcause::report!("{error:#}")))?;
        let name = names.into_iter().next().and_then(|name| {
            let full = [name.first_name, name.last_name]
                .into_iter()
                .flatten()
                .collect::<Vec<_>>()
                .join(" ");
            let full = full.trim().to_owned();
            (!full.is_empty()).then_some(full)
        });
        Ok(Some(Person {
            name,
            is_agent: account.is_agent,
        }))
    }
}
