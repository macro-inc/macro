//! Files the agent produced outside the conversation.

use agent_runtime_protocol::domain::schema::v0::Artifact;
use non_empty::NonEmpty;

use crate::domain::error::FoldError;
use crate::domain::model::{ArtifactItem, Author, FoldedMessage, MessagePart, TurnId};

use super::state::{Changed, FoldState};

impl FoldState {
    /// Attach collected files to the agent message they belong to.
    ///
    /// The frame is written by the Agent Service once a turn has ended, so it
    /// arrives after the turn it describes - possibly after a later prompt
    /// has already opened a turn of its own. The newest agent message in the
    /// transcript is therefore the right home for it, not whatever turn
    /// happens to be open; the turn itself is not reopened and its stop
    /// reason is left alone.
    pub(super) fn attach_artifacts(&mut self, artifacts: &[Artifact]) -> Option<Changed> {
        if artifacts.is_empty() {
            return None;
        }
        let items = artifacts.iter().map(ArtifactItem::of).collect::<Vec<_>>();

        let Some(message) = self.last_agent_message() else {
            return self.mint_artifacts_message(items);
        };

        // Merged into a trailing artifacts part rather than appended beside
        // it, so a second collection for one turn renders as one media strip
        // rather than two. Nothing about the streaming diff cares either way:
        // both shapes report the same message updated, and the client
        // replaces the message whole.
        let parts = &mut self.messages[message].parts;
        if let MessagePart::Artifacts { items: held } = parts.last_mut() {
            held.extend(items);
        } else {
            parts.push(MessagePart::Artifacts { items });
        }
        Some(Changed::updated(message))
    }

    /// Where the newest agent message sits in [`FoldState::messages`].
    fn last_agent_message(&self) -> Option<usize> {
        self.messages
            .iter()
            .rposition(|message| message.author == Author::Agent)
    }

    /// Mint the agent message a turn that produced nothing never opened, so
    /// its files have somewhere to live.
    ///
    /// Unlike [`FoldState::mint_agent_message`] this carries the artifacts
    /// alone, with no empty prose part: there was no prose.
    fn mint_artifacts_message(&mut self, items: Vec<ArtifactItem>) -> Option<Changed> {
        let Some(turn) = self.turns_opened.checked_sub(1) else {
            // Nothing has been prompted, so there is no turn these files
            // could have come out of. Minting a turn id here would collide
            // with the one the first prompt is about to take.
            self.warn(FoldError::ArtifactsBeforeAnyTurn);
            return None;
        };
        let message = self.messages.len();
        self.messages.push(FoldedMessage {
            id: TurnId(turn),
            author: Author::Agent,
            request_id: None,
            parts: NonEmpty::one(MessagePart::Artifacts { items }),
            stop: None,
        });
        Some(Changed::new(message))
    }
}

impl ArtifactItem {
    /// The renderable view of a collected file: everything the protocol
    /// carries but its dedupe key.
    fn of(artifact: &Artifact) -> Self {
        Self {
            uri: artifact.uri.clone(),
            name: artifact.name.clone(),
            mime_type: artifact.mime_type.clone(),
            size_bytes: artifact.size_bytes,
        }
    }
}
