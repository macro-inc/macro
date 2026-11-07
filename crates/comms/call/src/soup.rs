//! Conversion from call records into their Soup wire shape.

use crate::domain::models::{CallRecord, CallRecordParticipant};
use item_filters::CallStatus;
use models_soup::call_record::{SoupCallRecord, SoupCallRecordGuest, SoupCallRecordParticipant};

#[cfg(test)]
mod test;

/// Build a [`SoupCallRecord`] from a domain [`CallRecord`] in the context of
/// a specific viewer.
pub fn soup_call_record_for_user(record: CallRecord, user_id: &str) -> SoupCallRecord {
    let status = record
        .status
        .unwrap_or_else(|| participant_derived_status(&record.participants, user_id));
    let attended = status == CallStatus::Attended;

    SoupCallRecord {
        call_id: record.call_id,
        channel_id: record.channel_id,
        created_by: record.created_by,
        started_at: record.started_at,
        ended_at: record.ended_at,
        duration_ms: record.duration_ms,
        channel_name: record.channel_name,
        custom_name: record.custom_name,
        summary: record.summary,
        is_active: record.is_active,
        status,
        attended,
        participants: record
            .participants
            .into_iter()
            .map(|p| SoupCallRecordParticipant {
                user_id: p.user_id,
                joined_at: p.joined_at,
                left_at: p.left_at,
            })
            .collect(),
        guests: record
            .guests
            .into_iter()
            .map(|g| SoupCallRecordGuest {
                id: g.id.as_uuid(),
                display_name: g.display_name,
                joined_at: g.joined_at,
                left_at: g.left_at,
            })
            .collect(),
        extra: (),
    }
}

fn participant_derived_status(participants: &[CallRecordParticipant], user_id: &str) -> CallStatus {
    if participants.iter().any(|p| p.user_id == user_id) {
        return CallStatus::Attended;
    }

    CallStatus::Unattended
}
