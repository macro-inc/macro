//! Ensure teammate direct messages from a joining member and a teammate list.

#[cfg(test)]
mod test;

use std::future::Future;

use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::{
    dm::{EnsureDms, EnsureDmsSummary, ensure_dms_for_joining_member},
    ports::{ChannelMutationErr, ChannelService},
};

/// Creates missing teammate direct-message channels.
pub trait TeammateDirectMessages {
    /// Ensure every pair in `command` has a direct-message channel.
    fn ensure_dms(
        &self,
        command: EnsureDms,
    ) -> impl Future<Output = Result<EnsureDmsSummary, ChannelMutationErr>> + Send;
}

impl<T: ChannelService> TeammateDirectMessages for T {
    fn ensure_dms(
        &self,
        command: EnsureDms,
    ) -> impl Future<Output = Result<EnsureDmsSummary, ChannelMutationErr>> + Send {
        ChannelService::ensure_dms(self, command)
    }
}

/// Failure while ensuring teammate direct messages.
#[derive(Debug, thiserror::Error)]
pub enum TeammateDmError {
    /// Channel creation failed for the whole batch.
    #[error(transparent)]
    Channels(#[from] ChannelMutationErr),
    /// Some pairs in the batch could not be ensured.
    #[error("failed to ensure {failed} teammate direct messages")]
    Partial {
        /// Pairs created by this attempt.
        created: usize,
        /// Pairs that already had a channel.
        existing: usize,
        /// Pairs that failed.
        failed: usize,
    },
}

impl TeammateDmError {
    /// Whether the consumer should retry instead of committing the offset.
    pub fn is_transient(&self) -> bool {
        true
    }
}

/// Create a DM between `member_id` and every id in `teammate_ids`.
pub async fn ensure_joined_member_dms<C: TeammateDirectMessages>(
    channels: &C,
    member_id: MacroUserIdStr<'static>,
    teammate_ids: impl IntoIterator<Item = MacroUserIdStr<'static>>,
) -> Result<EnsureDmsSummary, TeammateDmError> {
    let summary = channels
        .ensure_dms(ensure_dms_for_joining_member(member_id, teammate_ids))
        .await?;
    if summary.failed > 0 {
        return Err(TeammateDmError::Partial {
            created: summary.created,
            existing: summary.existing,
            failed: summary.failed,
        });
    }
    Ok(summary)
}
