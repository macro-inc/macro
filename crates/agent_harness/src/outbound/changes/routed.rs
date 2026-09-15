//! Routing a session to the extractor for its harness family.

use agent_changes::domain::error::ExtractError;
use agent_changes::domain::model::ExtractedChangeset;
use agent_changes::domain::ports::ChangesetExtractor;
use agent_session::domain::model::AgentSession;

use crate::domain::model::AgentKind;

#[cfg(test)]
mod test;

/// Dispatches each session to the extractor its harness family answers to.
///
/// Managed sandboxes and the in-process agent have no extractor yet, so
/// their sessions are [`ExtractError::Unsupported`] - the pane says changes
/// are not available for that harness rather than showing nothing.
pub struct RoutedChangesetExtractor<Cursor, Macrod> {
    cursor: Cursor,
    macrod: Macrod,
}

impl<Cursor, Macrod> RoutedChangesetExtractor<Cursor, Macrod> {
    /// Wire the router over its extractors.
    pub fn new(cursor: Cursor, macrod: Macrod) -> Self {
        Self { cursor, macrod }
    }
}

impl<Cursor, Macrod> ChangesetExtractor for RoutedChangesetExtractor<Cursor, Macrod>
where
    Cursor: ChangesetExtractor,
    Macrod: ChangesetExtractor,
{
    async fn extract(&self, session: &AgentSession) -> Result<ExtractedChangeset, ExtractError> {
        match AgentKind::for_session(session.bot_id, &session.harness) {
            AgentKind::Cursor => self.cursor.extract(session).await,
            AgentKind::External => self.macrod.extract(session).await,
            AgentKind::SandboxedCoder | AgentKind::InMemory => Err(ExtractError::Unsupported {
                harness: session.harness.clone(),
            }),
        }
    }
}
