//! Setting what guests may do with an event. Only the organizer of a Google
//! event may: Outlook has no equivalent of Google's guest switches.
use super::*;
use crate::domain::capabilities::ViewerCapabilities;
use crate::domain::models::CalendarProvider;

/// Why an Outlook event refuses a guest policy, worded like the other
/// changes Microsoft Graph cannot represent.
const OUTLOOK_HAS_NO_GUEST_POLICY: &str = "Outlook events have no guest permissions to set";

/// Keep a new event's guest policy only when it departs from Google's
/// defaults, which Google applies on its own, and refuse one on Outlook.
pub(super) fn validate_draft_guest_policy(
    provider: CalendarProvider,
    draft: &mut CalendarEventDraft,
) -> Result<(), CalendarMutationError> {
    if draft.guest_policy.is_some_and(|policy| policy.is_default()) {
        draft.guest_policy = None;
    }
    match draft.guest_policy {
        Some(_) => require_policy_support(provider),
        None => Ok(()),
    }
}

/// Drop a guest policy the patch repeats at its stored value, and refuse a
/// change to one occurrence, on an Outlook event, or from anyone but the
/// organizer.
pub(super) fn require_guest_policy_rights(
    target: &CalendarEventMutationTarget,
    scope: &CalendarUpdateScope,
    capabilities: ViewerCapabilities,
    patch: &mut CalendarEventPatch,
) -> Result<(), CalendarMutationError> {
    let Some(policy) = patch.guest_policy else {
        return Ok(());
    };
    if policy == target.guest_policy {
        patch.guest_policy = None;
        return Ok(());
    }
    // Macro stores the policy on the series alone, so an occurrence's own
    // would be lost on the next read.
    if matches!(scope, CalendarUpdateScope::ThisEvent { .. }) {
        return Err(CalendarMutationError::InvalidInput(
            "guest permissions apply to the whole series; update all events to change them"
                .to_string(),
        ));
    }
    require_policy_support(target.token_identity.provider)?;
    if !capabilities.set_guest_policy {
        return Err(CalendarMutationError::NotOrganizer);
    }
    Ok(())
}

fn require_policy_support(provider: CalendarProvider) -> Result<(), CalendarMutationError> {
    match provider {
        CalendarProvider::Google => Ok(()),
        CalendarProvider::Outlook => Err(CalendarMutationError::ProviderRejected(
            OUTLOOK_HAS_NO_GUEST_POLICY.to_string(),
        )),
    }
}
