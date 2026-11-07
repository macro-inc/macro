//! Saved reviews announcing their new revisions.
//!
//! A review's record lives outside the log; each save logs only its id and
//! revision, so a reader knows when to fetch the record again.

use agent_client_protocol::RawJsonRpcParams;
use agent_runtime_protocol::domain::review::ReviewUpdatedNotification;

use super::convert::deserialize_params;
use super::state::FoldState;

impl FoldState {
    /// Record a review's newer revision. Whether the metadata moved: a save
    /// that committed first can be logged after a later one.
    pub(super) fn record_review_update(&mut self, params: Option<&RawJsonRpcParams>) -> bool {
        let Some(update) = deserialize_params::<ReviewUpdatedNotification>(params) else {
            return false;
        };
        let revisions = &mut self.metadata.review_revisions;
        match revisions
            .iter_mut()
            .find(|known| known.review_id == update.review_id)
        {
            Some(known) if known.revision >= update.revision => false,
            Some(known) => {
                known.revision = update.revision;
                true
            }
            None => {
                revisions.push(update);
                true
            }
        }
    }
}
