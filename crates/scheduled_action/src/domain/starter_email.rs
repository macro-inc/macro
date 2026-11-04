//! The email-tagging routine created for every new account.
//!
//! Signup calls [`email_triage_routine_id`] so a repeated webhook keeps the
//! same row and does not overwrite a later edit.

use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use serde_json::json;

use super::event_trigger::{ActionTrigger, EventFilter, EventFilters, EventName};
use super::models::{ActionConfiguration, ActionKind, RunVisibility};

/// Shown in the routines list.
pub const EMAIL_TRIAGE_ROUTINE_NAME: &str = "Tag new email";

/// Same id as `chat::domain::models::FREE_MODEL`, so a new free account can run it.
pub const EMAIL_TRIAGE_MODEL: &str = "google/gemini-3.8-flash";

/// What the routine tells the agent on each new email.
pub const EMAIL_TRIAGE_INSTRUCTIONS: &str = "\
Tag the email that just arrived with exactly one personal tag: Reply, Followup, Action, or FYI.

Reply: the sender is waiting on a response.
Followup: follow up later, or wait on someone else.
Action: the email asks for work that is not a reply.
FYI: informational, with nothing to do.

Use ListTags, create any of those four personal tags that are missing, then apply exactly one of them to this email thread with SetEntityProperty (entity type email, add_option_ids). Leave every other tag as it is. Do not send, archive, delete, or reply to the email.";

/// Personal tags the routine applies. Colors are palette hex values.
pub const EMAIL_TRIAGE_TAGS: [EmailTriageTag; 4] = [
    EmailTriageTag {
        label: "Reply",
        color: "#E5484D",
    },
    EmailTriageTag {
        label: "Followup",
        color: "#F76B15",
    },
    EmailTriageTag {
        label: "Action",
        color: "#8E4EC6",
    },
    EmailTriageTag {
        label: "FYI",
        color: "#889096",
    },
];

/// One starter tag: the label the routine uses, and its palette color.
pub struct EmailTriageTag {
    pub label: &'static str,
    pub color: &'static str,
}

/// Fixed namespace for the per-user routine id.
const EMAIL_TRIAGE_ID_NAMESPACE: Uuid = Uuid::from_u128(0x7a2e_19c4_5d80_4f63_b1a8_6c0d_3e94_2f57);

/// Deterministic id for this user's email-tagging routine.
pub fn email_triage_routine_id(user_id: &MacroUserIdStr<'_>) -> Uuid {
    Uuid::new_v5(&EMAIL_TRIAGE_ID_NAMESPACE, user_id.as_ref().as_bytes())
}

/// Saved configuration. Runs stay unlisted so each new email does not land on Home.
pub fn email_triage_configuration() -> ActionConfiguration {
    let filter = EventFilter::new(vec![EventName::EmailMessageReceived], None)
        .expect("one email event is a valid filter");
    ActionConfiguration {
        name: EMAIL_TRIAGE_ROUTINE_NAME.to_owned(),
        trigger: ActionTrigger::Events {
            filters: EventFilters::try_from(vec![filter]).expect("one filter is valid"),
        },
        kind: ActionKind::Agent,
        task: json!({
            "model": EMAIL_TRIAGE_MODEL,
            "prompt": "",
            "user_prompt": EMAIL_TRIAGE_INSTRUCTIONS,
        }),
        enabled: true,
        run_visibility: RunVisibility::Unlisted,
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use crate::domain::event_trigger::EventName;
    use properties::TagColor;

    fn user(id: &'static str) -> MacroUserIdStr<'static> {
        MacroUserIdStr::parse_from_str(id).expect("user id")
    }

    #[test]
    fn routine_id_is_stable_per_user() {
        let ada = user("macro|ada@macro.com");
        let grace = user("macro|grace@macro.com");
        assert_eq!(email_triage_routine_id(&ada), email_triage_routine_id(&ada));
        assert_ne!(
            email_triage_routine_id(&ada),
            email_triage_routine_id(&grace)
        );
    }

    #[test]
    fn configuration_tags_every_new_email_into_the_four_labels() {
        let config = email_triage_configuration();
        assert_eq!(config.name, "Tag new email");
        assert!(config.enabled);
        assert_eq!(config.run_visibility, RunVisibility::Unlisted);
        assert_eq!(config.task["model"], EMAIL_TRIAGE_MODEL);
        assert_eq!(config.task["user_prompt"], EMAIL_TRIAGE_INSTRUCTIONS);
        let ActionTrigger::Events { filters } = &config.trigger else {
            panic!("email triage is an event routine");
        };
        let filter = &filters.as_slice()[0];
        assert_eq!(filter.events(), &[EventName::EmailMessageReceived]);
        assert!(filter.condition().is_none());
        for tag in EMAIL_TRIAGE_TAGS {
            assert!(EMAIL_TRIAGE_INSTRUCTIONS.contains(tag.label));
        }
    }

    #[test]
    fn tag_colors_are_in_the_palette() {
        let palette = [
            TagColor::Red.hex(),
            TagColor::Orange.hex(),
            TagColor::Purple.hex(),
            TagColor::Gray.hex(),
        ];
        for tag in EMAIL_TRIAGE_TAGS {
            assert!(palette.contains(&tag.color), "{}", tag.label);
        }
    }
}
