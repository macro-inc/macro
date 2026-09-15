//! Authenticated cloud operations used by local and hosted session services.
use super::cloud::{
    CloudConversation, CloudEventStream, CloudId, CreatedTask, Launch, TaskSnapshot, TurnId,
};
use super::{CredentialStore, OAuth, Probe, unix_now};

/// An account binding validated before serving a conversation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RuntimeIdentity {
    /// Stable connection identity; reconnecting must create a new value.
    pub connection_id: String,
    /// Provider account identity.
    pub account_id: String,
}
/// Authenticated operations. Hosted implementations resolve authorization for every call.
pub trait CloudRuntime: Send + Sync {
    /// Return the current binding or reject disconnected authorization.
    fn identity(&self) -> impl Future<Output = Result<RuntimeIdentity, rootcause::Report>> + Send;
    /// Submit one launch, without write retries.
    fn launch(
        &self,
        request: &Launch,
    ) -> impl Future<Output = Result<CreatedTask, rootcause::Report>> + Send;
    /// Read selected task state.
    fn snapshot(
        &self,
        task: &CloudId,
    ) -> impl Future<Output = Result<TaskSnapshot, rootcause::Report>> + Send;
    /// Submit one continuation.
    fn follow_up(
        &self,
        task: &CloudId,
        turn: &TurnId,
        prompt: &str,
    ) -> impl Future<Output = Result<CreatedTask, rootcause::Report>> + Send;
    /// Request remote cancellation.
    fn cancel(&self, task: &CloudId) -> impl Future<Output = Result<(), rootcause::Report>> + Send;
    /// Read one assistant turn.
    fn turn(
        &self,
        task: &CloudId,
        turn: &TurnId,
    ) -> impl Future<Output = Result<TaskSnapshot, rootcause::Report>> + Send;
    /// Subscribe to one turn's event history and live updates.
    fn stream(
        &self,
        task: &CloudId,
        turn: &TurnId,
    ) -> impl Future<Output = Result<CloudEventStream, rootcause::Report>> + Send;
}
impl<P: OAuth + CloudConversation, S: CredentialStore + Send + Sync> CloudRuntime for Probe<P, S> {
    async fn identity(&self) -> Result<RuntimeIdentity, rootcause::Report> {
        let auth = self
            .status()?
            .ok_or_else(|| rootcause::report!("not connected; run login first"))?;
        Ok(RuntimeIdentity {
            connection_id: auth.account_id.clone(),
            account_id: auth.account_id,
        })
    }
    async fn launch(&self, request: &Launch) -> Result<CreatedTask, rootcause::Report> {
        self.launch(request, unix_now()?).await
    }
    async fn snapshot(&self, task: &CloudId) -> Result<TaskSnapshot, rootcause::Report> {
        self.snapshot(task, unix_now()?).await
    }
    async fn follow_up(
        &self,
        task: &CloudId,
        turn: &TurnId,
        prompt: &str,
    ) -> Result<CreatedTask, rootcause::Report> {
        self.follow_up(task, turn, prompt, unix_now()?).await
    }
    async fn cancel(&self, task: &CloudId) -> Result<(), rootcause::Report> {
        self.cancel(task, unix_now()?).await
    }
    async fn turn(&self, task: &CloudId, turn: &TurnId) -> Result<TaskSnapshot, rootcause::Report> {
        self.turn(task, turn, unix_now()?).await
    }
    async fn stream(
        &self,
        task: &CloudId,
        turn: &TurnId,
    ) -> Result<CloudEventStream, rootcause::Report> {
        self.stream(task, turn, unix_now()?).await
    }
}
