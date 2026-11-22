//! Compare committed physical folder state before waiting for later changes.
use super::*;
use async_imap::types::{Mailbox, UnsolicitedResponse};
use imap_proto::{Response, ResponseCode};

pub(super) fn selected_changed(committed: &FolderState, selected: &Mailbox) -> bool {
    // Virtual Gmail feeds carry physical watermarks but filtered counts.
    let physical_count = committed
        .virtual_label
        .as_deref()
        .is_none_or(|label| label == "\\All");
    committed.monitored
        && (selected.uid_validity != Some(committed.uid_validity)
            || selected.uid_next != committed.uid_next
            || (physical_count && Some(selected.exists) != committed.folder.total_items)
            || selected.highest_modseq != committed.highest_modseq)
}

pub(super) fn unsolicited_changed(response: &UnsolicitedResponse) -> bool {
    match response {
        UnsolicitedResponse::Exists(_)
        | UnsolicitedResponse::Expunge(_)
        | UnsolicitedResponse::Recent(_)
        | UnsolicitedResponse::Status { .. } => true,
        UnsolicitedResponse::Other(response) => match response.parsed() {
            Response::Fetch(..) | Response::Expunge(_) | Response::Vanished { .. } => true,
            Response::Data { outcome, .. } => {
                matches!(outcome.code, Some(ResponseCode::HighestModSeq(_)))
            }
            _ => false,
        },
    }
}
