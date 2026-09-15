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
    /// has already opened a turn of its own. A frame that names its `turn`
    /// says outright which one; the writer takes that ordinal from the same
    /// fold of the same log, so it always denotes the turn a reader derives
    /// under the same id. Without one, the newest agent message is the best
    /// guess left. Either way the turn is not reopened and its stop reason is
    /// left alone.
    pub(super) fn attach_artifacts(
        &mut self,
        artifacts: &[Artifact],
        turn: Option<u32>,
    ) -> Option<Changed> {
        // Every key the log has ever carried, whether or not the frame found
        // a home - a collector diffing against this is asking what is already
        // written down, not what is rendered.
        self.known_artifact_keys
            .extend(artifacts.iter().map(|artifact| artifact.key.clone()));

        if artifacts.is_empty() {
            return None;
        }
        let items = artifacts.iter().map(ArtifactItem::of).collect::<Vec<_>>();

        let message = match turn {
            Some(turn) if turn < self.turns_opened => {
                let turn = TurnId(turn);
                match self.agent_message_of(turn) {
                    Some(message) => message,
                    // The turn was opened and answered nothing - abandoned by
                    // a second prompt before any response closed it - so its
                    // files get a message of their own.
                    None => return self.mint_artifacts_message(turn, items),
                }
            }
            // A turn this fold has never opened. Attaching to some other turn
            // would file a walkthrough under work that did not produce it, and
            // minting the named turn would collide with the id the next prompt
            // is about to take.
            Some(turn) => {
                self.warn(FoldError::ArtifactsForUnknownTurn { turn: Some(turn) });
                return None;
            }
            None => match self.last_agent_message() {
                Some(message) => message,
                None => {
                    let Some(turn) = self.turns_opened.checked_sub(1) else {
                        // Nothing has been prompted, so there is no turn these
                        // files could have come out of.
                        self.warn(FoldError::ArtifactsForUnknownTurn { turn: None });
                        return None;
                    };
                    return self.mint_artifacts_message(TurnId(turn), items);
                }
            },
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

    /// Where `turn`'s agent message sits in [`FoldState::messages`].
    fn agent_message_of(&self, turn: TurnId) -> Option<usize> {
        self.messages
            .iter()
            .position(|message| message.id == turn && message.author == Author::Agent)
    }

    /// Mint the agent message a turn that produced nothing never opened, so
    /// its files have somewhere to live.
    ///
    /// Unlike [`FoldState::mint_agent_message`] this carries the artifacts
    /// alone, with no empty prose part: there was no prose.
    ///
    /// Appended, even when `turn` is older than the transcript's tail.
    /// [`FoldState::messages`] is derivation order, and every index the fold
    /// holds - tool positions, pending elicitations, the open turn's agent
    /// message - is an index into it, so inserting mid-list would invalidate
    /// them. Readers order by turn themselves: the web feed sorts on
    /// `(turn, author)` and reconciles rows by that pair, so a message
    /// arriving out of order still lands in its turn's place.
    fn mint_artifacts_message(
        &mut self,
        turn: TurnId,
        items: Vec<ArtifactItem>,
    ) -> Option<Changed> {
        let message = self.messages.len();
        self.messages.push(FoldedMessage {
            id: turn,
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
