//! Messages that are more than text (polls, locations, contact cards,
//! events), and system lines: what happened in a group, from live group
//! notifications, in-chat protocol messages (pins, call logs) and the stub
//! messages of history pages.

use chrono::{DateTime, Utc};
use external_chat::domain::rich::{
    Call, CallOutcome, ContactCard, Contacts, Event, Location, Poll, PollOption, PollVote,
    RichContent, SystemAction, SystemLine, created_subject, web_link,
};
use nom::Parser;
use nom::bytes::complete::{take_till, take_while1};
use nom::character::complete::char;
use nom::combinator::opt;
use nom::sequence::terminated;
use whatsmeow::msgsecret::hash_poll_options;
use whatsmeow::proto::wa_e2e;
use whatsmeow::proto::wa_e2e::call_log_message;
use whatsmeow::proto::wa_e2e::pin_in_chat_message;
use whatsmeow::proto::wa_web::WebMessageInfo;
use whatsmeow::proto::wa_web::web_message_info::StubType;
use whatsmeow::types::Jid;
use whatsmeow::types::events::GroupInfo;

use super::person;

/// Lowercase hex, how poll votes name options.
pub(super) fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn text(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn seconds_at(seconds: Option<i64>) -> Option<DateTime<Utc>> {
    DateTime::from_timestamp(seconds.filter(|seconds| *seconds > 0)?, 0)
}

/// Every poll creation message version that carries a plain poll.
fn poll_creation(message: &wa_e2e::Message) -> Option<&wa_e2e::PollCreationMessage> {
    [
        message.poll_creation_message.as_deref(),
        message.poll_creation_message_v2.as_deref(),
        message.poll_creation_message_v3.as_deref(),
        message.poll_creation_message_v5.as_deref(),
        message.poll_creation_message_v6.as_deref(),
    ]
    .into_iter()
    .flatten()
    .next()
}

fn poll(creation: &wa_e2e::PollCreationMessage) -> RichContent {
    RichContent::Poll(Poll {
        question: creation.name.clone().unwrap_or_default(),
        options: {
            let names: Vec<String> = creation
                .options
                .iter()
                .map(|option| option.option_name.clone().unwrap_or_default())
                .collect();
            let hashes = hash_poll_options(&names);
            names
                .into_iter()
                .zip(hashes)
                .map(|(name, hash)| PollOption {
                    name,
                    hash: hex(&hash),
                })
                .collect()
        },
        selectable_count: creation.selectable_options_count.unwrap_or(0),
    })
}

fn location(location: &wa_e2e::LocationMessage) -> Option<Location> {
    Some(Location {
        latitude: location.degrees_latitude?,
        longitude: location.degrees_longitude?,
        name: text(location.name.as_deref()),
        address: text(location.address.as_deref()),
        url: location.url.as_deref().and_then(web_link),
        live: location.is_live.unwrap_or(false),
        comment: text(location.comment.as_deref()),
    })
}

/// One vCard content line, `[group.]NAME[;params]:value`, as (NAME, value).
fn content_line(line: &str) -> Option<(&str, &str)> {
    let token = || take_while1(|c: char| c.is_ascii_alphanumeric() || c == '-');
    let (value, (_, name, _, _)) = (
        opt(terminated(token(), char('.'))),
        token(),
        take_till(|c| c == ':'),
        char::<&str, nom::error::Error<&str>>(':'),
    )
        .parse(line)
        .ok()?;
    Some((name, value))
}

/// The name and phone numbers of a vCard. Only what a card shows; the rest
/// of the vCard is not kept.
fn vcard(card: &str) -> (Option<String>, Vec<String>) {
    // Folded lines continue with a leading space or tab.
    let mut lines: Vec<String> = Vec::new();
    for line in card.lines() {
        match (line.strip_prefix([' ', '\t']), lines.last_mut()) {
            (Some(rest), Some(last)) => last.push_str(rest),
            _ => lines.push(line.trim_end_matches('\r').to_owned()),
        }
    }
    let mut name = None;
    let mut phones = Vec::new();
    for (property, value) in lines.iter().filter_map(|line| content_line(line)) {
        if property.eq_ignore_ascii_case("FN") {
            name = text(Some(value)).or(name);
        } else if property.eq_ignore_ascii_case("TEL")
            && let Some(phone) = text(Some(value))
        {
            phones.push(phone);
        }
    }
    (name, phones)
}

fn contact_card(contact: &wa_e2e::ContactMessage) -> ContactCard {
    let (card_name, phones) = vcard(contact.vcard.as_deref().unwrap_or_default());
    ContactCard {
        name: text(contact.display_name.as_deref())
            .or(card_name)
            .unwrap_or_default(),
        phones,
    }
}

fn event(event: &wa_e2e::EventMessage) -> RichContent {
    RichContent::Event(Event {
        name: event.name.clone().unwrap_or_default(),
        description: text(event.description.as_deref()),
        start_at: seconds_at(event.start_time),
        end_at: seconds_at(event.end_time),
        location: event.location.as_deref().and_then(|place| {
            text(place.name.as_deref()).or_else(|| text(place.address.as_deref()))
        }),
        join_link: event.join_link.as_deref().and_then(web_link),
        canceled: event.is_canceled.unwrap_or(false),
    })
}

/// A poll, location, contact card or event.
pub(super) fn rich_of(message: &wa_e2e::Message) -> Option<RichContent> {
    if let Some(creation) = poll_creation(message) {
        return Some(poll(creation));
    }
    if let Some(place) = message.location_message.as_deref() {
        return Some(RichContent::Location(location(place)?));
    }
    if let Some(live) = message.live_location_message.as_deref() {
        return Some(RichContent::Location(Location {
            latitude: live.degrees_latitude?,
            longitude: live.degrees_longitude?,
            name: None,
            address: None,
            url: None,
            live: true,
            comment: text(live.caption.as_deref()),
        }));
    }
    if let Some(contact) = message.contact_message.as_deref() {
        return Some(RichContent::Contacts(Contacts {
            contacts: vec![contact_card(contact)],
        }));
    }
    if let Some(contacts) = message.contacts_array_message.as_deref() {
        return Some(RichContent::Contacts(Contacts {
            contacts: contacts.contacts.iter().map(contact_card).collect(),
        }));
    }
    message.event_message.as_deref().map(event)
}

/// The context of a rich part (polls and events carry their own).
pub(super) fn rich_context(message: &wa_e2e::Message) -> Option<&wa_e2e::ContextInfo> {
    [
        poll_creation(message).and_then(|poll| poll.context_info.as_deref()),
        message
            .location_message
            .as_ref()
            .and_then(|part| part.context_info.as_deref()),
        message
            .live_location_message
            .as_ref()
            .and_then(|part| part.context_info.as_deref()),
        message
            .contact_message
            .as_ref()
            .and_then(|part| part.context_info.as_deref()),
        message
            .contacts_array_message
            .as_ref()
            .and_then(|part| part.context_info.as_deref()),
        message
            .event_message
            .as_ref()
            .and_then(|part| part.context_info.as_deref()),
    ]
    .into_iter()
    .flatten()
    .next()
}

/// A vote: the hashes of the options chosen now.
pub(super) fn poll_vote(selected: &[Vec<u8>]) -> RichContent {
    RichContent::PollVote(PollVote {
        selected: selected.iter().map(|hash| hex(hash)).collect(),
    })
}

fn line(action: SystemAction) -> SystemLine {
    SystemLine {
        action,
        participants: vec![],
        value: None,
        call: None,
        by_whatsapp: false,
    }
}

/// A new group icon.
pub(super) fn icon_line() -> SystemLine {
    line(SystemAction::IconChanged)
}

/// Pin and unpin, as a system line.
pub(super) fn pin_line(pin: &wa_e2e::PinInChatMessage) -> Option<SystemLine> {
    let action = match pin
        .r#type
        .and_then(|value| pin_in_chat_message::Type::try_from(value).ok())?
    {
        pin_in_chat_message::Type::PinForAll => SystemAction::MessagePinned,
        pin_in_chat_message::Type::UnpinForAll => SystemAction::MessageUnpinned,
        pin_in_chat_message::Type::UnknownType => return None,
    };
    Some(line(action))
}

/// A call log, as a system line.
pub(super) fn call_line(call: &wa_e2e::CallLogMessage) -> SystemLine {
    let outcome = match call
        .call_outcome
        .and_then(|value| call_log_message::CallOutcome::try_from(value).ok())
    {
        Some(call_log_message::CallOutcome::Connected) => CallOutcome::Answered,
        Some(
            call_log_message::CallOutcome::Missed
            | call_log_message::CallOutcome::SilencedByDnd
            | call_log_message::CallOutcome::SilencedUnknownCaller,
        ) => CallOutcome::Missed,
        Some(call_log_message::CallOutcome::Rejected) => CallOutcome::Rejected,
        _ => CallOutcome::Other,
    };
    SystemLine {
        call: Some(Call {
            video: call.is_video.unwrap_or(false),
            outcome,
            duration_seconds: call
                .duration_secs
                .filter(|seconds| *seconds > 0)
                .and_then(|seconds| u32::try_from(seconds).ok()),
        }),
        ..line(SystemAction::Call)
    }
}

fn people(jids: &[Jid]) -> Vec<String> {
    jids.iter().filter_map(person).collect()
}

/// The system lines of a live group notification, in the order WhatsApp
/// lists the changes. `actor` is who made them, when WhatsApp said.
pub(super) fn group_info_lines(change: &GroupInfo, actor: Option<&str>) -> Vec<SystemLine> {
    let mut lines = Vec::new();
    if let Some(name) = &change.name {
        lines.push(SystemLine {
            value: text(Some(&name.name)),
            ..line(SystemAction::SubjectChanged)
        });
    }
    if let Some(topic) = &change.topic {
        lines.push(SystemLine {
            value: (!topic.topic_deleted)
                .then(|| text(Some(&topic.topic)))
                .flatten(),
            ..line(SystemAction::DescriptionChanged)
        });
    }
    if let Some(ephemeral) = &change.ephemeral {
        let seconds = if ephemeral.is_ephemeral {
            ephemeral.disappearing_timer
        } else {
            0
        };
        lines.push(SystemLine {
            value: Some(seconds.to_string()),
            ..line(SystemAction::DisappearingChanged)
        });
    }
    let by_themselves = |jids: &[Jid]| {
        actor.is_none_or(|actor| people(jids).iter().any(|jid| jid.as_str() == actor))
    };
    if !change.join.is_empty() {
        let action = if change.join_reason == "invite" || by_themselves(&change.join) {
            SystemAction::ParticipantsJoined
        } else {
            SystemAction::ParticipantsAdded
        };
        lines.push(SystemLine {
            participants: people(&change.join),
            ..line(action)
        });
    }
    if !change.leave.is_empty() {
        let action = if by_themselves(&change.leave) {
            SystemAction::ParticipantsLeft
        } else {
            SystemAction::ParticipantsRemoved
        };
        lines.push(SystemLine {
            participants: people(&change.leave),
            ..line(action)
        });
    }
    if !change.promote.is_empty() {
        lines.push(SystemLine {
            participants: people(&change.promote),
            ..line(SystemAction::ParticipantsPromoted)
        });
    }
    if !change.demote.is_empty() {
        lines.push(SystemLine {
            participants: people(&change.demote),
            ..line(SystemAction::ParticipantsDemoted)
        });
    }
    lines
}

/// A stub parameter naming a person: a JID, or (newer phones) a JSON object
/// with the phone number and LID.
fn stub_person(parameter: &str) -> Option<String> {
    if let Ok(jid) = parameter.parse::<Jid>()
        && !jid.user.is_empty()
    {
        return person(&jid);
    }
    let value: serde_json::Value = serde_json::from_str(parameter).ok()?;
    ["pn", "phoneNumber", "lid", "jid", "id"]
        .into_iter()
        .filter_map(|key| value.get(key)?.as_str())
        .find_map(|jid| jid.parse::<Jid>().ok().as_ref().and_then(person))
}

/// The system line of a stub message in a history page (WhatsApp keeps
/// what happened in a group as stub messages in the chat).
pub(super) fn stub_line(web: &WebMessageInfo) -> Option<SystemLine> {
    let stub = StubType::try_from(web.message_stub_type?).ok()?;
    let parameters = &web.message_stub_parameters;
    let first = || text(parameters.first().map(String::as_str));
    let participants = || parameters.iter().filter_map(|p| stub_person(p)).collect();
    let missed = |video: bool| SystemLine {
        call: Some(Call {
            video,
            outcome: CallOutcome::Missed,
            duration_seconds: None,
        }),
        ..line(SystemAction::Call)
    };
    Some(match stub {
        StubType::GroupCreate => SystemLine {
            value: parameters
                .first()
                .map(String::as_str)
                .and_then(created_subject),
            ..line(SystemAction::GroupCreated)
        },
        StubType::GroupChangeSubject => SystemLine {
            value: first(),
            ..line(SystemAction::SubjectChanged)
        },
        StubType::GroupChangeIcon => line(SystemAction::IconChanged),
        StubType::GroupChangeDescription => SystemLine {
            value: first(),
            ..line(SystemAction::DescriptionChanged)
        },
        StubType::ChangeEphemeralSetting => SystemLine {
            value: first(),
            ..line(SystemAction::DisappearingChanged)
        },
        StubType::GroupParticipantAdd => SystemLine {
            participants: participants(),
            ..line(SystemAction::ParticipantsAdded)
        },
        StubType::GroupParticipantRemove => SystemLine {
            participants: participants(),
            ..line(SystemAction::ParticipantsRemoved)
        },
        StubType::GroupParticipantLeave => SystemLine {
            participants: participants(),
            ..line(SystemAction::ParticipantsLeft)
        },
        StubType::GroupParticipantInvite | StubType::GroupParticipantAccept => SystemLine {
            participants: participants(),
            ..line(SystemAction::ParticipantsJoined)
        },
        StubType::GroupParticipantPromote => SystemLine {
            participants: participants(),
            ..line(SystemAction::ParticipantsPromoted)
        },
        StubType::GroupParticipantDemote => SystemLine {
            participants: participants(),
            ..line(SystemAction::ParticipantsDemoted)
        },
        StubType::CallMissedVoice | StubType::CallMissedGroupVoice => missed(false),
        StubType::CallMissedVideo | StubType::CallMissedGroupVideo => missed(true),
        StubType::PinnedMessageInChat => {
            let pin = web.pin_in_chat.as_ref()?;
            let action = match pin
                .r#type
                .and_then(|value| pin_in_chat_message::Type::try_from(value).ok())?
            {
                pin_in_chat_message::Type::PinForAll => SystemAction::MessagePinned,
                pin_in_chat_message::Type::UnpinForAll => SystemAction::MessageUnpinned,
                pin_in_chat_message::Type::UnknownType => return None,
            };
            line(action)
        }
        _ => return None,
    })
}

#[cfg(test)]
mod test;
