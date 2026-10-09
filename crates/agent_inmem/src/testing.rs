//! Test doubles shared by this crate's tests.

use agent::{AgentError, StreamPart};
use ai_billing::domain::{AdmissionFuture, AiAdmissionError, AiAdmissionService};
use ai_usage::AiFeature;
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Mutex;
use tokio::sync::mpsc;

use crate::domain::engine::{AgentIdentity, TurnEngine, TurnRequest};

/// Mutable admission result, recording the trusted identity and feature.
pub(crate) struct TestAdmission {
    pub(crate) result: Mutex<Result<(), AiAdmissionError>>,
    pub(crate) calls: Mutex<Vec<(String, AiFeature)>>,
}

impl TestAdmission {
    pub(crate) fn new(result: Result<(), AiAdmissionError>) -> Self {
        Self {
            result: Mutex::new(result),
            calls: Mutex::new(Vec::new()),
        }
    }
}

impl AiAdmissionService for TestAdmission {
    fn admit<'a>(
        &'a self,
        user: &'a MacroUserIdStr<'_>,
        feature: AiFeature,
    ) -> AdmissionFuture<'a> {
        self.calls.lock().unwrap().push((user.to_string(), feature));
        let result = *self.result.lock().unwrap();
        Box::pin(async move { result })
    }
}

/// Real disabled policy around unavailable billing: no admission path may touch it.
pub(crate) fn disabled_admission() -> std::sync::Arc<dyn AiAdmissionService> {
    std::sync::Arc::new(ai_billing::domain::BillingAdmissionService::new(
        std::sync::Arc::new(UnavailableBilling),
        ai_usage::AiUsageEnforcement::Disabled,
    ))
}

struct UnavailableBilling;

impl ai_billing::domain::BillingService for UnavailableBilling {
    async fn check_allowance(
        &self,
        _: &MacroUserIdStr<'_>,
    ) -> ai_billing::domain::Result<ai_billing::domain::AllowanceDecision> {
        panic!("disabled policy must not contact unavailable billing")
    }

    async fn snapshot(
        &self,
        _: &MacroUserIdStr<'_>,
    ) -> ai_billing::domain::Result<ai_billing::domain::UsageSnapshot> {
        panic!("admission must not fetch snapshots")
    }

    async fn settle(&self, _: &MacroUserIdStr<'_>) -> ai_billing::domain::Result<()> {
        panic!("admission must not settle")
    }

    async fn update_overage(
        &self,
        _: &MacroUserIdStr<'_>,
        _: bool,
        _: i64,
    ) -> ai_billing::domain::Result<ai_billing::domain::UsageSnapshot> {
        panic!("admission must not change settings")
    }

    async fn update_auto_reload(
        &self,
        _: &MacroUserIdStr<'_>,
        _: bool,
        _: ai_billing::domain::AutoReloadThresholds,
    ) -> ai_billing::domain::Result<ai_billing::domain::UsageSnapshot> {
        panic!("admission must not change settings")
    }

    async fn create_credit_checkout(
        &self,
        _: &MacroUserIdStr<'_>,
        _: i64,
        _: String,
        _: String,
    ) -> ai_billing::domain::Result<String> {
        panic!("admission must not purchase credits")
    }

    async fn apply_credit_purchase(
        &self,
        _: &MacroUserIdStr<'_>,
        _: i64,
        _: &str,
    ) -> ai_billing::domain::Result<()> {
        panic!("admission must not apply credits")
    }

    async fn sync_period(
        &self,
        _: &MacroUserIdStr<'_>,
        _: sqlx::types::chrono::DateTime<sqlx::types::chrono::Utc>,
        _: sqlx::types::chrono::DateTime<sqlx::types::chrono::Utc>,
        _: Option<ai_billing::domain::period::SubscriptionPeriod>,
    ) -> ai_billing::domain::Result<()> {
        panic!("admission must not sync periods")
    }

    async fn mark_overage_invoice(&self, _: &str, _: bool) -> ai_billing::domain::Result<()> {
        panic!("admission must not handle invoices")
    }

    async fn mark_credit_reload_invoice(&self, _: &str, _: bool) -> ai_billing::domain::Result<()> {
        panic!("admission must not handle invoices")
    }
}

/// Models advertised by shared test engines.
pub(crate) const TEST_MODELS: &[&str] = &[
    "anthropic/claude-sonnet-5-5",
    "other-model",
    chat::domain::models::FREE_MODEL,
];

/// An engine that plays back a script of parts for every turn.
pub(crate) struct ScriptedEngine {
    script: Vec<StreamPart>,
    /// One entry per turn the engine has been asked to run.
    requests: std::sync::Mutex<Vec<RecordedTurn>>,
}

/// What one turn asked of the engine, as far as tests care.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RecordedTurn {
    /// Model the turn was to run on.
    pub(crate) model: String,
    /// Reasoning effort the turn was to use.
    pub(crate) reasoning_effort: agent::ReasoningEffort,
    /// Provider speed selected for this turn.
    pub(crate) speed: agent::ModelSpeed,
    /// The conversation, flattened to text per message.
    pub(crate) messages: Vec<String>,
    /// Every image URL attached across the conversation, in order.
    pub(crate) images: Vec<String>,
    /// The session's instructions, as handed to the engine.
    pub(crate) instructions: Option<String>,
    /// Who the agent is, as handed to the engine.
    pub(crate) identity: Option<AgentIdentity>,
}

impl ScriptedEngine {
    pub(crate) fn new(script: Vec<StreamPart>) -> Self {
        Self {
            script,
            requests: std::sync::Mutex::new(Vec::new()),
        }
    }

    pub(crate) fn requests(&self) -> Vec<RecordedTurn> {
        self.requests.lock().expect("requests lock").clone()
    }
}

impl TurnEngine for ScriptedEngine {
    fn supported_models(&self) -> &[&str] {
        TEST_MODELS
    }

    fn run_turn(&self, request: TurnRequest) -> mpsc::Receiver<Result<StreamPart, AgentError>> {
        self.requests
            .lock()
            .expect("requests lock")
            .push(RecordedTurn {
                model: request.model.clone(),
                reasoning_effort: request.reasoning_effort,
                speed: request.speed,
                messages: request
                    .messages
                    .iter()
                    .map(|message| message.content.message_text_with_tools())
                    .collect(),
                images: request
                    .messages
                    .iter()
                    .filter_map(|message| message.attachments.as_ref())
                    .flat_map(|attachments| attachments.parts().iter())
                    .filter_map(|resolved| resolved.as_ref().ok())
                    .flat_map(|content| content.content.iter())
                    .filter_map(|part| match part {
                        attachment::AttachmentPart::Image(
                            attachment::image::ImageData::StaticUrl(url),
                        ) => Some(url.clone()),
                        _ => None,
                    })
                    .collect(),
                instructions: request.instructions.clone(),
                identity: request.identity.clone(),
            });
        let (parts, receiver) = mpsc::channel(64);
        let script = self.script.clone();
        tokio::spawn(async move {
            for part in script {
                if parts.send(Ok(part)).await.is_err() {
                    break;
                }
            }
        });
        receiver
    }
}

/// An engine that never produces anything until cancelled.
pub(crate) struct HangingEngine;

impl TurnEngine for HangingEngine {
    fn supported_models(&self) -> &[&str] {
        TEST_MODELS
    }

    fn run_turn(&self, request: TurnRequest) -> mpsc::Receiver<Result<StreamPart, AgentError>> {
        let (parts, receiver) = mpsc::channel(1);
        tokio::spawn(async move {
            request.cancel.cancelled().await;
            drop(parts);
        });
        receiver
    }
}

/// Mutable plan lookup used to exercise upgrades, downgrades, and lookup errors.
pub(crate) struct TestModelAccess {
    pub(crate) result: Mutex<
        Result<
            crate::domain::model_access::ModelAccess,
            crate::domain::model_access::ModelAccessError,
        >,
    >,
    pub(crate) owners: Mutex<Vec<model_owner::Owner>>,
}

impl TestModelAccess {
    pub(crate) fn new(access: crate::domain::model_access::ModelAccess) -> Self {
        Self {
            result: Mutex::new(Ok(access)),
            owners: Mutex::new(Vec::new()),
        }
    }

    pub(crate) fn paid() -> Self {
        Self::new(crate::domain::model_access::ModelAccess::Paid)
    }
}

#[async_trait::async_trait]
impl crate::domain::model_access::InMemModelAccess for TestModelAccess {
    async fn access(
        &self,
        owner: &model_owner::Owner,
    ) -> Result<
        crate::domain::model_access::ModelAccess,
        crate::domain::model_access::ModelAccessError,
    > {
        self.owners.lock().unwrap().push(owner.clone());
        *self.result.lock().unwrap()
    }
}
