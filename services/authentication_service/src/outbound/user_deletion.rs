//! Account deletion through the owning services, followed by MacroDB cleanup.

use std::{sync::Arc, time::Duration};

use document_storage_service_client::DocumentStorageServiceClient;
use macro_authorization::INTERNAL_API_KEY_HEADER;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::{
    Report,
    prelude::{IntoRootcause, ResultExt},
};
use sqlx::PgPool;
use teams::domain::team_repo::TeamService;
use uuid::Uuid;

use crate::service::user::delete_user::UserDeletionGateway;

/// HTTP, in-process team service, Stripe, and database adapter composed at
/// authentication-service startup.
pub struct UserDeletionAdapter<T: TeamService> {
    db: PgPool,
    documents: Arc<DocumentStorageServiceClient>,
    teams: Arc<T>,
    stripe: Arc<stripe::Client>,
    client: reqwest::Client,
    internal_key: String,
    harness_url: String,
    scheduled_action_url: String,
}

impl<T: TeamService> UserDeletionAdapter<T> {
    /// Construct a bounded HTTP client. Redirects must not turn a failed
    /// internal DELETE into an unrelated successful response.
    ///
    /// `internal_key` is the fleet-wide internal service key that the agent
    /// harness and scheduled-action services validate. This service's own
    /// inbound key is a different secret and is rejected by them.
    pub fn new(
        db: PgPool,
        documents: Arc<DocumentStorageServiceClient>,
        teams: Arc<T>,
        stripe: Arc<stripe::Client>,
        internal_key: String,
        harness_url: String,
        scheduled_action_url: String,
    ) -> Result<Self, Report> {
        Ok(Self {
            db,
            documents,
            teams,
            stripe,
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(300))
                .redirect(reqwest::redirect::Policy::none())
                .build()?,
            internal_key,
            harness_url,
            scheduled_action_url,
        })
    }

    async fn delete_owned(
        &self,
        base: &str,
        resource: &str,
        user: &MacroUserIdStr<'static>,
    ) -> Result<(), Report> {
        let url = format!(
            "{}/{resource}/user/{}",
            base.trim_end_matches('/'),
            urlencoding::encode(user.as_ref())
        );
        let response = self
            .client
            .delete(url)
            .header(INTERNAL_API_KEY_HEADER, &self.internal_key)
            .send()
            .await
            .context_with(|| format!("failed to delete user's {resource}"))?;
        if response.status() != reqwest::StatusCode::NO_CONTENT {
            return Err(rootcause::report!("user cleanup did not complete")
                .attach(format!("{resource}: {}", response.status())));
        }
        Ok(())
    }
}

impl<T: TeamService> UserDeletionGateway for UserDeletionAdapter<T> {
    async fn delete_scheduled_actions(&self, user: &MacroUserIdStr<'static>) -> Result<(), Report> {
        self.delete_owned(&self.scheduled_action_url, "scheduled-actions", user)
            .await
    }

    async fn delete_agent_sessions(&self, user: &MacroUserIdStr<'static>) -> Result<(), Report> {
        self.delete_owned(&self.harness_url, "agent-sessions", user)
            .await
    }

    async fn leave_teams(&self, user: &MacroUserIdStr<'static>) -> Result<(), Report> {
        self.teams
            .remove_user_from_all_teams(user)
            .await
            .map_err(|error| Report::new(error).into_dynamic())
            .context("failed to remove user from teams")?;
        Ok(())
    }

    async fn delete_items(&self, user: &MacroUserIdStr<'static>) -> Result<(), Report> {
        self.documents
            .delete_all_user_items(user.as_ref())
            .await
            .into_rootcause()
            .context("failed to delete user items")?;
        Ok(())
    }

    async fn delete_profile(
        &self,
        user: &MacroUserIdStr<'static>,
        account: &Uuid,
    ) -> Result<(), Report> {
        macro_db_client::user::delete_user::delete_user(&self.db, user.as_ref(), account)
            .await
            .context("failed to delete user profile")?;
        Ok(())
    }

    async fn delete_billing_customer(&self, account: &Uuid) -> Result<(), Report> {
        let customer_id =
            match macro_db_client::macro_user::get_macro_user(&self.db, &account.to_string()).await
            {
                Ok(account) => account.stripe_customer_id,
                // A retry after the account row is gone has nothing left to delete.
                Err(error)
                    if matches!(
                        error.downcast_ref::<sqlx::Error>(),
                        Some(sqlx::Error::RowNotFound)
                    ) =>
                {
                    None
                }
                Err(error) => Err(error.into_rootcause())
                    .context("failed to load account for billing cleanup")?,
            };
        let Some(customer_id) = customer_id else {
            return Ok(());
        };
        let customer_id: stripe::CustomerId = match customer_id.parse() {
            Ok(customer_id) => customer_id,
            // Local stacks store placeholder ids: there is nothing in Stripe to
            // delete, and failing here would block the deletion forever.
            Err(error) => {
                tracing::warn!(
                    error = ?error,
                    "stripe customer id is not a stripe id; skipping customer deletion"
                );
                return Ok(());
            }
        };

        stripe::Customer::delete(&self.stripe, &customer_id)
            .await
            .map(drop)
            .or_else(|error| match error {
                // Already deleted, for example by an earlier attempt.
                stripe::StripeError::Stripe(request)
                    if matches!(request.code, Some(stripe::ErrorCode::ResourceMissing)) =>
                {
                    Ok(())
                }
                error => Err(Report::new(error).into_dynamic()),
            })
            .context("failed to delete stripe customer")?;
        Ok(())
    }

    async fn delete_account(&self, account: &Uuid) -> Result<(), Report> {
        macro_db_client::macro_user::delete_macro_user(&self.db, account)
            .await
            .into_rootcause()
            .context("failed to delete macro user")?;
        Ok(())
    }
}
