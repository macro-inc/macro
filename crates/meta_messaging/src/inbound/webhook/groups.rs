//! Independently decode confirmed group facts; unsupported siblings retain their path.
use super::*;
use crate::domain::groups::*;

pub(super) fn decode(
    field: &str,
    value: &Value,
    events: &mut Decoder,
) -> Result<(), MessagingError> {
    let account_id = id(&value["metadata"], "phone_number_id")?;
    for group in items(value, "groups", events) {
        events.capture(|events| {
            let timestamp = timestamp(&group["timestamp"], false)?;
            let kind = string(group, "type")?;
            let error = optional_array(group, "errors").first().map(|error| {
                error["code"]
                    .as_i64()
                    .map(|c| c.to_string())
                    .unwrap_or_else(|| "provider_rejected".into())
            });
            let fact = match (field, kind) {
                ("group_lifecycle_update", "group_create") => {
                    let request_id = id(group, "request_id")?;
                    if error.is_some() {
                        GroupFact::Created {
                            request_id,
                            group_id: None,
                            subject: None,
                            invite_link: None,
                            error_code: error,
                        }
                    } else {
                        let link = string(group, "invite_link")?;
                        if !link.starts_with("https://chat.whatsapp.com/")
                            || link.len() > 2048
                            || link.chars().any(char::is_whitespace)
                        {
                            return Err(MessagingError::Invalid("invalid group invite link"));
                        }
                        GroupFact::Created {
                            request_id,
                            group_id: Some(id(group, "group_id")?),
                            subject: Some(string(group, "subject")?.into()),
                            invite_link: Some(link.into()),
                            error_code: None,
                        }
                    }
                }
                ("group_lifecycle_update", "group_delete") if error.is_none() => {
                    GroupFact::Deleted {
                        group_id: id(group, "group_id")?,
                    }
                }
                (
                    "group_participants_update",
                    "group_participants_add" | "group_participants_remove",
                ) => {
                    let group_id = id(group, "group_id")?;
                    let active = kind == "group_participants_add";
                    // Partial failures may carry top-level errors and successful siblings.
                    for person in items(
                        group,
                        if active {
                            "added_participants"
                        } else {
                            "removed_participants"
                        },
                        events,
                    ) {
                        events.capture(|events| {
                            let customer_id = id(person, "user_id")
                                .or_else(|_| id(person, "input"))
                                .or_else(|_| id(person, "wa_id"))?;
                            if person.get("user_id").is_some() && !customer_id.is_whatsapp_bsuid() {
                                return Err(MessagingError::Invalid(
                                    "invalid group participant BSUID",
                                ));
                            }
                            events.push(IncomingEvent::Group(GroupEvent {
                                account_id: account_id.clone(),
                                timestamp,
                                fact: GroupFact::Participant {
                                    group_id: group_id.clone(),
                                    participant: ParticipantFact {
                                        customer_id,
                                        phone: person
                                            .get("wa_id")
                                            .map(|_| id(person, "wa_id"))
                                            .transpose()?,
                                        display_name: optional_string(person, "name"),
                                        username: optional_string(person, "username"),
                                        active,
                                    },
                                },
                            }));
                            Ok(())
                        });
                    }
                    return Ok(());
                }
                ("group_settings_update", "group_settings_update")
                    if group["group_subject"]["update_successful"] == true =>
                {
                    GroupFact::Subject {
                        group_id: id(group, "group_id")?,
                        subject: string(&group["group_subject"], "text")?.into(),
                    }
                }
                ("group_status_update", "group_suspend" | "group_suspend_cleared")
                    if error.is_none() =>
                {
                    GroupFact::Status {
                        group_id: id(group, "group_id")?,
                        status: if kind == "group_suspend" {
                            GroupStatus::Suspended
                        } else {
                            GroupStatus::Active
                        },
                    }
                }
                _ => {
                    events.push(IncomingEvent::Unsupported {
                        account_id: Some(account_id.clone()),
                        field: kind.into(),
                    });
                    return Ok(());
                }
            };
            events.push(IncomingEvent::Group(GroupEvent {
                account_id: account_id.clone(),
                timestamp,
                fact,
            }));
            Ok(())
        });
    }
    Ok(())
}

#[cfg(test)]
mod test;
