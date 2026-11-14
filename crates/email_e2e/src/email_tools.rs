//! The email tools an AI agent calls, run in this process against the
//! scenario's database and queues.
//!
//! The hosts that give the tools to a model (`agent_harness_service`, the MCP
//! server) are not started: this builds the tool context the way
//! `ai_tools::build_tool_service_context_from_env` does, on the scenario's
//! Postgres database and SQS queues, so what a tool stages is carried out by
//! the scenario's real `pubsub_workers`. No model is involved; a scenario
//! calls a tool by name with the JSON a model would send.

use crate::{Report, Stack, User};
use ai_toolset::{RequestContext, ToolSet};
use crm::{
    domain::service::CrmServiceImpl,
    outbound::{
        companies_repo::CompaniesRepositoryImpl, no_op_resolver::NoOpCompanyMetadataResolver,
    },
};
use email::{
    domain::{ports::NoOpGmailTokenProvider, service::EmailServiceImpl},
    inbound::toolset::{EmailToolContext, email_toolset},
    outbound::EmailPgRepo,
};
use entity_access::{domain::service::EntityAccessServiceImpl, outbound::PgAccessRepository};
use entity_access_management::{
    domain::service::EntityAccessManagementServiceImpl, outbound::PgRepository,
};
use frecency::{domain::services::FrecencyQueryServiceImpl, outbound::postgres::FrecencyPgStorage};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::prelude::*;
use serde_json::Value;
use std::sync::Arc;

type Service = EmailServiceImpl<
    EmailPgRepo,
    FrecencyQueryServiceImpl<FrecencyPgStorage>,
    sqs_client::SQS,
    CrmServiceImpl<CompaniesRepositoryImpl, NoOpCompanyMetadataResolver>,
    EntityAccessManagementServiceImpl<PgRepository>,
>;
type Access = EntityAccessServiceImpl<PgAccessRepository>;
type Context = EmailToolContext<Service, NoOpGmailTokenProvider, Access>;

/// The service the tools would render Markdown through. A scenario gives a
/// sending tool the HTML a composer exports, so nothing is asked of it.
const LEXICAL: &str = "lexical";

/// The email tools of one scenario. See [`Stack::email_tools`].
pub struct EmailTools {
    context: Context,
}

impl Stack {
    /// The email tools an AI agent has (`SendEmail`, `SendConfirmedEmail`,
    /// `GetThread`, `ListInboxes`, `ListLabels`, `UpdateThreadLabels`,
    /// `SetSenderPolicy`), on this scenario's database and queues.
    pub fn email_tools(&self) -> Result<EmailTools, Report> {
        let pool = self.db().clone();
        let queues = self.queues();
        let sqs = sqs_client::SQS::new(queues.client().clone())
            .gmail_ops_queue(&queues.named("gmail-ops")?.url)
            .email_scheduled_queue(&queues.named("scheduled")?.url);
        let service = EmailServiceImpl::new(
            EmailPgRepo::new(pool.clone()),
            FrecencyQueryServiceImpl::new(FrecencyPgStorage::new(pool.clone())),
            sqs,
            CrmServiceImpl::new(
                CompaniesRepositoryImpl::new(pool.clone()),
                NoOpCompanyMetadataResolver,
            ),
            EntityAccessManagementServiceImpl::new(PgRepository::new(pool.clone())),
            0,
        );
        Ok(EmailTools {
            context: EmailToolContext::new(
                Arc::new(service),
                Arc::new(NoOpGmailTokenProvider),
                Arc::new(EntityAccessServiceImpl::new(PgAccessRepository::new(pool))),
                Arc::new(lexical_client::LexicalClient::new(
                    self.internal_api_key().to_owned(),
                    self.service_url(LEXICAL),
                )),
            ),
        })
    }
}

impl EmailTools {
    /// Calls the tool `name` as `user` with the JSON input a model would
    /// send. `Ok(Ok(output))` is the tool's result; `Ok(Err(description))`
    /// is the failure the model would be told about.
    pub async fn call(
        &self,
        user: &User,
        name: &str,
        input: &Value,
    ) -> Result<Result<Value, String>, Report> {
        let user_id = MacroUserIdStr::try_from(user.macro_id().to_owned())
            .map_err(|error| report!("{} is not a Macro user id: {error}", user.macro_id()))?;
        let result = email_toolset::<Service, NoOpGmailTokenProvider, Access>()
            .try_tool_call(
                self.context.clone(),
                RequestContext::new(user_id),
                name,
                input,
            )
            .await
            .map_err(|error| report!("the email toolset refused the call to {name}: {error}"))?;
        Ok(result.map_err(|error| error.description))
    }
}
