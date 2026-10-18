//! WhatsApp's live, status, coexistence and system-message identity contracts.
//! Source: Meta BSUID documentation, September 15, 2026 revision.
use super::*;

struct Customer {
    id: ProviderId,
    phone: Option<ProviderId>,
    name: Option<String>,
    handle: Option<String>,
}

fn optional_id(value: &Value, key: &str) -> Result<Option<ProviderId>, MessagingError> {
    value.get(key).map(|_| id(value, key)).transpose()
}
fn phone(id: &ProviderId) -> bool {
    (6..=15).contains(&id.as_str().len()) && id.as_str().bytes().all(|b| b.is_ascii_digit())
}
fn customer(
    source: &Value,
    bsuid_key: &str,
    phone_key: &str,
    contacts: &[Value],
) -> Result<Customer, MessagingError> {
    let mut bsuid = optional_id(source, bsuid_key)?;
    if bsuid.as_ref().is_some_and(|id| !id.is_whatsapp_bsuid()) {
        return Err(MessagingError::Invalid(
            "invalid WhatsApp business-scoped identifier",
        ));
    }
    let mut number = optional_id(source, phone_key)?;
    let mut name = None;
    let mut handle = None;
    for contact in contacts
        .iter()
        .filter(|contact| {
            bsuid
                .as_ref()
                .is_some_and(|id| contact["user_id"].as_str() == Some(id.as_str()))
                || number
                    .as_ref()
                    .is_some_and(|id| contact["wa_id"].as_str() == Some(id.as_str()))
        })
        .collect::<Vec<_>>()
    {
        let contact_id = optional_id(contact, "user_id")?;
        let contact_phone = optional_id(contact, "wa_id")?;
        if contact_id
            .as_ref()
            .is_some_and(|id| !id.is_whatsapp_bsuid() || bsuid.as_ref().is_some_and(|b| b != id))
            || contact_phone
                .as_ref()
                .is_some_and(|id| number.as_ref().is_some_and(|p| p != id))
        {
            return Err(MessagingError::IdentityConflict);
        }
        bsuid = bsuid.or(contact_id);
        number = number.or(contact_phone);
        name = optional_string(&contact["profile"], "name");
        handle = optional_string(&contact["profile"], "username");
    }
    let id = bsuid
        .or_else(|| number.clone())
        .ok_or(MessagingError::Invalid(
            "WhatsApp customer identity is missing",
        ))?;
    Ok(Customer {
        id,
        phone: number.filter(phone),
        name,
        handle,
    })
}

fn push_message(
    message: &Value,
    account: &ProviderId,
    customer: impl FnOnce() -> Result<Customer, MessagingError>,
    provenance: Provenance,
    direction: Direction,
    events: &mut Decoder,
) -> Result<(), MessagingError> {
    let kind = string(message, "type")?;
    if kind == "system" {
        let system = &message["system"];
        if !matches!(
            system["type"].as_str(),
            Some("user_changed_number" | "user_changed_user_id")
        ) {
            events.push(IncomingEvent::Unsupported {
                account_id: Some(account.clone()),
                field: "system".into(),
            });
            return Ok(());
        }
        let previous = optional_id(system, "previous_user_id")?
            .or(optional_id(message, "from")?)
            .ok_or(MessagingError::Invalid(
                "previous WhatsApp identity is missing",
            ))?;
        let current = optional_id(system, "user_id")?
            .or(optional_id(system, "wa_id")?)
            .ok_or(MessagingError::Invalid("new WhatsApp identity is missing"))?;
        events.push(IncomingEvent::IdentityUpdate(IdentityUpdate {
            provenance,
            account_id: account.clone(),
            previous,
            previous_phone: optional_id(message, "from")?.filter(phone),
            current,
            phone: optional_id(system, "wa_id")?.filter(phone),
            timestamp: timestamp(&message["timestamp"], false)?,
        }));
        return Ok(());
    }
    if matches!(kind, "reaction" | "edit")
        || (message.get("group_id").is_some() && kind == "revoke")
    {
        events.push(IncomingEvent::Unsupported {
            account_id: Some(account.clone()),
            field: kind.into(),
        });
        return Ok(());
    }
    let customer = customer()?;
    if kind == "revoke" {
        let timestamp = timestamp(&message["timestamp"], false)?;
        events.push(IncomingEvent::IdentityObserved {
            provenance,
            account_id: account.clone(),
            customer_id: customer.id.clone(),
            phone: customer.phone,
            timestamp,
        });
        events.push(IncomingEvent::Revision(IncomingRevision {
            provenance,
            account_id: account.clone(),
            customer_id: customer.id,
            message_id: id(&message["revoke"], "original_message_id")?,
            direction,
            timestamp,
            change: MessageRevision::Deleted,
        }));
        return Ok(());
    }
    let mut normalized = wa_message(
        message,
        account.clone(),
        customer.id,
        provenance,
        customer.name,
        Some(direction),
    )?;
    normalized.group_id = optional_id(message, "group_id")?;
    normalized.customer_phone = customer.phone;
    normalized.author_handle = customer.handle;
    events.push(IncomingEvent::Message(normalized));
    Ok(())
}

pub(super) fn decode(entry: &Value, events: &mut Decoder) -> Result<(), MessagingError> {
    for change in array(entry, "changes")? {
        events.capture(|events| {
            let field = string(change, "field")?;
            let value = &change["value"];
            if field == "account_update" && value["event"] == "PARTNER_REMOVED" {
                events.push(IncomingEvent::Disconnected {
                    account_id: id(entry, "id")?,
                    business_account: true,
                });
                return Ok(());
            }
            if matches!(
                field,
                "group_lifecycle_update"
                    | "group_participants_update"
                    | "group_settings_update"
                    | "group_status_update"
            ) {
                return super::groups::decode(field, value, events);
            }
            if !matches!(field, "messages" | "smb_message_echoes" | "history") {
                events.push(IncomingEvent::Unsupported {
                    account_id: id(&value["metadata"], "phone_number_id").ok(),
                    field: field.into(),
                });
                return Ok(());
            }
            let account = id(&value["metadata"], "phone_number_id")?;
            let contacts = optional_array(value, "contacts");
            let provenance = match field {
                "history" => Provenance::OnboardingHistory,
                "smb_message_echoes" => Provenance::PhoneEcho,
                _ => Provenance::Customer,
            };
            for (collection, direction, bsuid_key, phone_key) in [
                ("messages", Direction::Inbound, "from_user_id", "from"),
                ("message_echoes", Direction::Outbound, "to_user_id", "to"),
            ] {
                for message in items(value, collection, events) {
                    events.capture(|events| {
                        let before = events.batch.events.len();
                        push_message(
                            message,
                            &account,
                            || customer(message, bsuid_key, phone_key, contacts),
                            provenance,
                            direction,
                            events,
                        )?;
                        if field == "history"
                            && let Some(IncomingEvent::Message(normalized)) =
                                events.batch.events.get_mut(before)
                            && !normalized.media.is_empty()
                        {
                            normalized.message_type = "history_media".into();
                        }
                        Ok(())
                    });
                }
            }
            for status in items(value, "statuses", events) {
                events.capture(|events| {
                    let state = match string(status, "status")? {
                        "sent" => DeliveryState::Sent,
                        "delivered" => DeliveryState::Delivered,
                        "read" => DeliveryState::Read,
                        "failed" => DeliveryState::Failed,
                        _ => return Err(MessagingError::Invalid("unsupported WhatsApp status")),
                    };
                    let group = status["recipient_type"] == "group";
                    if (group && !matches!(state, DeliveryState::Sent | DeliveryState::Failed))
                        || [
                            "recipient_participant_id",
                            "participant_recipient_id",
                            "recipient_participant_user_id",
                            "recipient_participant_parent_user_id",
                        ]
                        .iter()
                        .any(|field| status.get(*field).is_some())
                    {
                        return Ok(());
                    }
                    let at = timestamp(&status["timestamp"], false)?;
                    if !group && status.get("recipient_user_id").is_some() {
                        let identity =
                            customer(status, "recipient_user_id", "recipient_id", contacts)?;
                        events.push(IncomingEvent::IdentityObserved {
                            provenance,
                            account_id: account.clone(),
                            customer_id: identity.id,
                            phone: identity.phone,
                            timestamp: at,
                        });
                    }
                    events.push(IncomingEvent::Status {
                        group_id: if group {
                            Some(id(status, "recipient_id")?)
                        } else {
                            None
                        },
                        provenance,
                        account_id: account.clone(),
                        message_id: id(status, "id")?,
                        state,
                        timestamp: at,
                        error_code: optional_array(status, "errors")
                            .first()
                            .and_then(|e| e["code"].as_i64())
                            .map(|c| c.to_string()),
                    });
                    Ok(())
                });
            }
            for chunk in items(value, "history", events) {
                events.capture(|events| {
                    for thread in items(chunk, "threads", events) {
                        events.capture(|events| {
                            let mut context = thread["context"].clone();
                            if context.is_null() {
                                context = serde_json::json!({});
                            }
                            if context.get("wa_id").is_none()
                                && let Some(number) = thread.get("id")
                            {
                                context["wa_id"] = number.clone();
                            }
                            let identity = customer(&context, "user_id", "wa_id", &[])?;
                            for message in array(thread, "messages")? {
                                events.capture(|events| {
                                    let business_sender = message["from"]
                                        .as_str()
                                        .zip(value["metadata"]["display_phone_number"].as_str())
                                        .is_some_and(|(sender, business)| {
                                            !sender.is_empty()
                                                && sender.bytes().all(|b| b.is_ascii_digit())
                                                && sender.chars().eq(business
                                                    .chars()
                                                    .filter(char::is_ascii_digit))
                                        });
                                    let direction = if business_sender {
                                        Direction::Outbound
                                    } else if message["from_user_id"].as_str()
                                        == Some(identity.id.as_str())
                                        || message["from"].as_str() == context["wa_id"].as_str()
                                            && message.get("from").is_some()
                                    {
                                        Direction::Inbound
                                    } else if message.get("from").is_some()
                                        && message.get("from_user_id").is_none()
                                    {
                                        Direction::Outbound
                                    } else {
                                        return Err(MessagingError::Invalid(
                                            "history direction is missing",
                                        ));
                                    };
                                    let customer = Customer {
                                        id: identity.id.clone(),
                                        phone: identity.phone.clone(),
                                        name: None,
                                        handle: optional_string(&context, "username"),
                                    };
                                    push_message(
                                        message,
                                        &account,
                                        || Ok(customer),
                                        Provenance::OnboardingHistory,
                                        direction,
                                        events,
                                    )
                                });
                            }
                            Ok(())
                        });
                    }
                    events.push(IncomingEvent::HistoryProgress {
                        account_id: account.clone(),
                        progress: chunk["metadata"]["progress"]
                            .as_u64()
                            .and_then(|n| u8::try_from(n).ok())
                            .filter(|n| *n <= 100),
                        declined: optional_array(chunk, "errors")
                            .iter()
                            .any(|e| e["code"] == 2593109),
                    });
                    Ok(())
                });
            }
            Ok(())
        });
    }
    Ok(())
}
fn wa_message(
    message: &Value,
    account_id: ProviderId,
    customer_id: ProviderId,
    provenance: Provenance,
    author_name: Option<String>,
    direction: Option<Direction>,
) -> Result<IncomingMessage, MessagingError> {
    let kind = string(message, "type")?;
    let mut media = Vec::new();
    let content = match kind {
        "text" => string(&message["text"], "body")?.to_owned(),
        "image" | "sticker" | "audio" | "video" | "document" => {
            let source = &message[kind];
            media.push(IncomingMedia {
                kind: match kind {
                    "audio" => MediaKind::Audio,
                    "video" => MediaKind::Video,
                    "document" => MediaKind::Document,
                    _ => MediaKind::Image,
                },
                id: Some(id(source, "id")?),
                url: None,
                mime_type: optional_string(source, "mime_type"),
                filename: optional_string(source, "filename"),
                sha256: optional_string(source, "sha256"),
            });
            optional_string(source, "caption").unwrap_or_default()
        }
        "location" => content::whatsapp_location(&message["location"]),
        "contacts" => content::whatsapp_contacts(&message["contacts"]),
        "button" => {
            content::label(&message["button"], "text").unwrap_or_else(|| "Selected a button".into())
        }
        "interactive" => content::whatsapp_selection(&message["interactive"]),
        "media_placeholder" => {
            "Attachment not provided by WhatsApp. View it in the original app.".to_owned()
        }
        _ => "Content unavailable".to_owned(),
    };
    let mut content = content;
    if let Some(headline) = content::label(&message["referral"], "headline") {
        append_content(&mut content, &format!("From an ad: {headline}"));
    }
    Ok(IncomingMessage {
        group_id: None,
        provider: Provider::Whatsapp,
        account_id,
        customer_id,
        customer_phone: None,
        message_id: id(message, "id")?,
        author_name,
        author_handle: None,
        content,
        timestamp: timestamp(&message["timestamp"], false)?,
        direction: direction.unwrap_or(if provenance == Provenance::PhoneEcho {
            Direction::Outbound
        } else {
            Direction::Inbound
        }),
        provenance,
        message_type: kind.to_owned(),
        reply_to: message.get("context").and_then(|c| id(c, "id").ok()),
        media,
    })
}
