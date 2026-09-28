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
use uuid::Uuid;

use crate::service::user::delete_user::UserDeletionGateway;

/// HTTP and database adapter composed at authentication-service startup.
pub struct UserDeletionAdapter {
    db: PgPool,
    documents: Arc<DocumentStorageServiceClient>,
    client: reqwest::Client,
    internal_key: String,
    harness_url: String,
    scheduled_action_url: String,
}

impl UserDeletionAdapter {
    /// Construct a bounded HTTP client. Redirects must not turn a failed
    /// internal DELETE into an unrelated successful response.
    pub fn new(
        db: PgPool,
        documents: Arc<DocumentStorageServiceClient>,
        internal_key: String,
        harness_url: String,
        scheduled_action_url: String,
    ) -> Result<Self, Report> {
        Ok(Self {
            db,
            documents,
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

impl UserDeletionGateway for UserDeletionAdapter {
    async fn delete_scheduled_actions(&self, user: &MacroUserIdStr<'static>) -> Result<(), Report> {
        self.delete_owned(&self.scheduled_action_url, "scheduled-actions", user)
            .await
    }

    async fn delete_agent_sessions(&self, user: &MacroUserIdStr<'static>) -> Result<(), Report> {
        self.delete_owned(&self.harness_url, "agent-sessions", user)
            .await
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

    async fn delete_account(&self, account: &Uuid) -> Result<(), Report> {
        macro_db_client::macro_user::delete_macro_user(&self.db, account)
            .await
            .into_rootcause()
            .context("failed to delete macro user")?;
        Ok(())
    }
}
