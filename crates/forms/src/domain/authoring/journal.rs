//! Durable retry identity and actor-scoped authoring baselines.
use super::{validate::Prepared, *};
use macro_user_id::user_id::MacroUserIdStr;
use models_forms::FormId;
use serde::{Deserialize, Serialize};

/// Exact semantic input retained to reject reuse of a retry key for another request.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "input", rename_all = "camelCase")]
pub enum Intent {
    /// Complete creation request.
    Create(Create),
    /// Targeted edit request.
    Edit(Edit),
    /// Reviewed access transition.
    Access(SetAccess),
}
impl Intent {
    /// Client retry key for every mutation kind.
    pub fn request_id(&self) -> AuthoringRequestId {
        match self {
            Self::Create(i) => i.request_id,
            Self::Edit(i) => i.request_id,
            Self::Access(i) => i.request_id,
        }
    }
}
/// A record is claimed before dispatching any side effect and never blindly replayed.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Operation {
    /// Exact canonical command.
    pub intent: Intent,
    /// Reserved layout/schema identities survive interrupted creation.
    pub prepared: Option<Prepared>,
    /// Latest acknowledged phase and truthful result.
    pub result: MutationResult,
}
/// Only the newly inserted claimant may start side effects.
pub enum Claim {
    /// This caller owns execution.
    New(Operation),
    /// Another call already claimed this retry identity.
    Existing(Operation),
}
/// Forms-owned persistence. No distributed transaction is implied by a record.
pub trait AuthoringJournal: Send + Sync + 'static {
    /// Atomically claim actor/requestId or return its existing record.
    fn claim(
        &self,
        actor: &MacroUserIdStr<'_>,
        operation: Operation,
    ) -> impl Future<Output = Result<Claim, AuthoringError>> + Send;
    /// Persist an acknowledged phase. Failure leaves the previous phase uncertain.
    fn save(
        &self,
        actor: &MacroUserIdStr<'_>,
        operation: &Operation,
    ) -> impl Future<Output = Result<(), AuthoringError>> + Send;
    /// Read only this actor's operation; authorization on the form is checked separately.
    fn operation(
        &self,
        actor: &MacroUserIdStr<'_>,
        id: AuthoringOperationId,
    ) -> impl Future<Output = Result<Option<Operation>, AuthoringError>> + Send;
    /// Retain a baseline for 24 hours, scoped to this actor and form.
    fn retain(
        &self,
        actor: &MacroUserIdStr<'_>,
        snapshot: &Snapshot,
    ) -> impl Future<Output = Result<AuthoringRevisionId, AuthoringError>> + Send;
    /// Read an unexpired baseline; never accept caller-provided preimages.
    fn baseline(
        &self,
        actor: &MacroUserIdStr<'_>,
        form: FormId,
        revision: AuthoringRevisionId,
    ) -> impl Future<Output = Result<Option<Snapshot>, AuthoringError>> + Send;
    /// Read direct recipients after the workflow proves Owner.
    fn grants(
        &self,
        form: FormId,
    ) -> impl Future<Output = Result<Vec<Grant>, AuthoringError>> + Send;
    /// Commit settings and explicit grant deltas at the observed metadata/draft baseline.
    /// The workflow requires the table version for schema-dependent or exposing changes;
    /// pure restrictions remain possible while respondents are writing rows.
    fn settings(
        &self,
        expected: &Snapshot,
        update: &models_forms::UpdateForm,
        grants: &[GrantChange],
        check_grants: bool,
        check_table_version: bool,
    ) -> impl Future<Output = Result<(), AuthoringError>> + Send;
}
