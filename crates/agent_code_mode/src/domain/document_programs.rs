//! Programs embedded in a document the user opened, run for that user.
//!
//! The browser preview of an HTML file hands the document's `text/macro`
//! blocks to the server, which runs them through [`super::UserCodeMode`] as
//! the viewer and returns only the result. The credential never reaches the
//! page.
use async_trait::async_trait;
use macro_user_id::user_id::MacroUserIdStr;

/// The per-user rollout flag, shared with the web app's `defineFlag` key.
pub const DOCUMENT_PROGRAMS_FLAG: &str = "enable-html-code-mode";

/// Whether a user may run a document's embedded programs: a rollout gate,
/// never an authorization. The run still acts under the user's own credential.
#[async_trait]
pub trait DocumentProgramGate: Send + Sync + 'static {
    /// `false` when the rollout excludes the user or cannot be read.
    async fn allows(&self, user: &MacroUserIdStr<'static>) -> bool;
}
