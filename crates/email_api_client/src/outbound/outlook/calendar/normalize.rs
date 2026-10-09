use super::*;
use chrono::{DateTime, NaiveDate, NaiveDateTime, TimeZone, Utc};

#[cfg(test)]
mod test;

pub(super) fn instant(value: &Value) -> Result<DateTime<Utc>, CalendarProviderError> {
    let text = string(value, "dateTime")?;
    if let Ok(instant) = DateTime::parse_from_rfc3339(text) {
        return Ok(instant.with_timezone(&Utc));
    }
    let local =
        NaiveDateTime::parse_from_str(text, "%Y-%m-%dT%H:%M:%S%.f").map_err(|_| invalid())?;
    // Requests receive UTC by default. Never guess an unknown Windows zone or
    // choose one side of an ambiguous local-time response silently.
    let zone = zones::zone(value["timeZone"].as_str().unwrap_or("UTC")).ok_or_else(invalid)?;
    zone.from_local_datetime(&local)
        .single()
        .map(|v| v.with_timezone(&Utc))
        .ok_or_else(invalid)
}

pub(super) fn event_time(value: &Value) -> Result<EventTime, CalendarProviderError> {
    let start = instant(&value["start"])?;
    let end = instant(&value["end"])?;
    let zone_name = value["originalStartTimeZone"]
        .as_str()
        .or(value["start"]["timeZone"].as_str())
        .unwrap_or("UTC");
    // Graph returns authoritative UTC instants even for legacy custom zones.
    // Prefer the returned display zone when the original zone is not portable.
    let zone = zones::zone(zone_name)
        .or_else(|| value["start"]["timeZone"].as_str().and_then(zones::zone))
        .unwrap_or(chrono_tz::UTC);
    let time = if value["isAllDay"].as_bool() == Some(true) {
        EventTime::AllDay {
            start_date: start.with_timezone(&zone).date_naive(),
            end_date: end.with_timezone(&zone).date_naive(),
        }
    } else {
        EventTime::Timed {
            starts_at: start,
            ends_at: end,
            time_zone: Some(zone.name().into()),
        }
    };
    if !time.is_valid() {
        return Err(invalid());
    }
    Ok(time)
}

pub(super) fn original(value: &Value) -> Result<Option<EventStart>, CalendarProviderError> {
    let Some(text) = value["originalStart"].as_str() else {
        return Ok(None);
    };
    let instant = DateTime::parse_from_rfc3339(text)
        .map_err(|_| invalid())?
        .with_timezone(&Utc);
    if value["isAllDay"].as_bool() == Some(true) {
        let zone = zones::zone(value["originalStartTimeZone"].as_str().unwrap_or("UTC"))
            .or_else(|| value["start"]["timeZone"].as_str().and_then(zones::zone))
            .unwrap_or(chrono_tz::UTC);
        Ok(Some(EventStart::AllDay(
            instant.with_timezone(&zone).date_naive(),
        )))
    } else {
        Ok(Some(EventStart::Timed(instant)))
    }
}

pub(super) fn response(value: Option<&str>) -> AttendeeResponseStatus {
    match value {
        Some("accepted" | "organizer") => AttendeeResponseStatus::Accepted,
        Some("tentativelyAccepted") => AttendeeResponseStatus::Tentative,
        Some("declined") => AttendeeResponseStatus::Declined,
        _ => AttendeeResponseStatus::NeedsAction,
    }
}

fn visibility(sensitivity: &str) -> EventVisibility {
    match sensitivity {
        "private" | "personal" => EventVisibility::Private,
        "confidential" => EventVisibility::Confidential,
        _ => EventVisibility::Default,
    }
}

fn transparency(show_as: &str) -> EventTransparency {
    if show_as == "free" {
        EventTransparency::Transparent
    } else {
        EventTransparency::Opaque
    }
}

fn attendees(value: &Value) -> Vec<CalendarAttendee> {
    let organizer = value["organizer"]["emailAddress"]["address"].as_str();
    let mut attendees: Vec<_> = value["attendees"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|v| {
            let address = v["emailAddress"]["address"].as_str()?;
            Some(CalendarAttendee {
                email: address.to_ascii_lowercase(),
                display_name: v["emailAddress"]["name"].as_str().map(str::to_owned),
                response_status: response(v["status"]["response"].as_str()),
                is_organizer: organizer.is_some_and(|o| o.eq_ignore_ascii_case(address)),
                is_optional: v["type"].as_str() == Some("optional"),
                is_self: false,
                comment: None,
            })
        })
        .collect();
    if let Some(email) = organizer
        && !attendees
            .iter()
            .any(|a| a.email.eq_ignore_ascii_case(email))
    {
        attendees.push(CalendarAttendee {
            email: email.to_ascii_lowercase(),
            display_name: value["organizer"]["emailAddress"]["name"]
                .as_str()
                .map(str::to_owned),
            response_status: AttendeeResponseStatus::Accepted,
            is_organizer: true,
            is_optional: false,
            is_self: false,
            comment: None,
        });
    }
    attendees
}

fn event_reminders(value: &Value, preferences: &Value) -> EventReminders {
    // An edit in Outlook to its native reminder supersedes Macro's extra
    // reminder metadata; never resurrect old reminder choices on the next sync.
    let own_reminders = (preferences["nativeReminderOn"] == value["isReminderOn"]
        && (value["isReminderOn"].as_bool() != Some(true)
            || preferences["nativeReminderMinutes"] == value["reminderMinutesBeforeStart"]))
        .then(|| preferences.get("reminders").cloned())
        .flatten();
    own_reminders
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_else(|| EventReminders {
            use_default: false,
            overrides: if value["isReminderOn"].as_bool() == Some(true) {
                vec![EventReminderOverride {
                    method: "popup".into(),
                    minutes: value["reminderMinutesBeforeStart"]
                        .as_u64()
                        .unwrap_or(15)
                        .min(u32::MAX as u64) as u32,
                }]
            } else {
                vec![]
            },
        })
}

pub(super) fn projection(
    target: &ProviderCalendarTarget,
    master: Value,
    instances: Vec<Value>,
) -> Result<CalendarEventUpsert, CalendarProviderError> {
    let event_id = Uuid::now_v7();
    let time = event_time(&master)?;
    let updated = master["lastModifiedDateTime"]
        .as_str()
        .and_then(|v| DateTime::parse_from_rfc3339(v).ok())
        .map(|v| v.with_timezone(&Utc))
        .ok_or_else(invalid)?;
    let created = master["createdDateTime"]
        .as_str()
        .and_then(|v| DateTime::parse_from_rfc3339(v).ok())
        .map(|v| v.with_timezone(&Utc))
        .unwrap_or(updated);
    let master_preferences = preferences(&master);
    let reminders = event_reminders(&master, &master_preferences);
    let conference_url = master["onlineMeeting"]["joinUrl"]
        .as_str()
        .or(master["onlineMeetingUrl"].as_str())
        .map(str::to_owned);
    let event = CalendarEvent {
        id: event_id,
        owner_id: target.owner_id.clone(),
        ical_uid: string(&master, "iCalUId")?.into(),
        calendar_id: Some(target.calendar_id),
        sources: vec![],
        title: master["subject"].as_str().unwrap_or_default().into(),
        description: master["body"]["content"].as_str().map(str::to_owned),
        location: master["location"]["displayName"]
            .as_str()
            .map(str::to_owned),
        status: if master["isCancelled"].as_bool() == Some(true) {
            EventStatus::Cancelled
        } else if master["showAs"].as_str() == Some("tentative") {
            EventStatus::Tentative
        } else {
            EventStatus::Confirmed
        },
        visibility: master["sensitivity"]
            .as_str()
            .map(visibility)
            .unwrap_or_default(),
        transparency: master["showAs"]
            .as_str()
            .map(transparency)
            .unwrap_or_default(),
        event_type: if master["showAs"].as_str() == Some("oof") {
            EventType::OutOfOffice
        } else {
            EventType::Default
        },
        time,
        recurrence_lines: recurrence::from_graph(&master)?,
        organizer_email: master["organizer"]["emailAddress"]["address"]
            .as_str()
            .map(str::to_ascii_lowercase),
        organizer_name: master["organizer"]["emailAddress"]["name"]
            .as_str()
            .map(str::to_owned),
        creator_email: None,
        creator_name: None,
        conference_provider: conference_url.as_ref().map(|_| {
            if master["onlineMeetingProvider"].as_str() == Some("teamsForBusiness") {
                ConferenceProvider::MicrosoftTeams
            } else {
                ConferenceProvider::Other
            }
        }),
        conference_url,
        sequence: sequence(&master).unwrap_or(0),
        is_read_only: target.is_read_only,
        attendees: attendees(&master),
        reminders,
        created_at: created,
        updated_at: updated,
    };
    let mut occurrences = std::collections::BTreeMap::new();
    let mut overrides = vec![];
    for instance in instances {
        if instance["isCancelled"].as_bool() == Some(true) {
            continue;
        }
        let time = event_time(&instance)?;
        let original = original(&instance)?;
        let recurrence_id = original.as_ref().map(EventStart::occurrence_key);
        if instance["type"].as_str() == Some("exception") {
            let original_time = original.ok_or_else(invalid)?;
            let instance_preferences = preferences(&instance);
            // Graph may omit inherited extended properties. Preserve the series'
            // extra reminders unless this instance carries its own settings or
            // its native reminder was explicitly changed in Outlook.
            let effective_preferences = if instance_preferences.get("reminders").is_some() {
                &instance_preferences
            } else {
                &master_preferences
            };
            overrides.push(CalendarEventOverride {
                reminders: Some(event_reminders(&instance, effective_preferences)),
                automatic_decline: instance_preferences
                    .get("automaticDecline")
                    .cloned()
                    .map(serde_json::from_value)
                    .transpose()
                    .map_err(|_| invalid())?,
                recurrence_id: original_time.occurrence_key(),
                original_time,
                time: time.clone(),
                sequence: sequence(&instance),
                source_updated_at: instance["lastModifiedDateTime"]
                    .as_str()
                    .and_then(|v| DateTime::parse_from_rfc3339(v).ok())
                    .map(|v| v.with_timezone(&Utc)),
                title: instance["subject"].as_str().map(str::to_owned),
                description: instance["body"]["content"].as_str().map(str::to_owned),
                location: instance["location"]["displayName"]
                    .as_str()
                    .map(str::to_owned),
                status: Some(EventStatus::Confirmed),
                visibility: instance["sensitivity"].as_str().map(visibility),
                transparency: instance["showAs"].as_str().map(transparency),
                attendees: Some(attendees(&instance)),
            });
        }
        if time.overlaps(&target.range) {
            let key = recurrence_id
                .clone()
                .unwrap_or_else(|| time.occurrence_key());
            occurrences.insert(
                key.clone(),
                CalendarOccurrence {
                    event_id,
                    occurrence_key: key,
                    recurrence_id,
                    time,
                    is_cancelled: false,
                },
            );
        }
    }
    Ok(CalendarEventUpsert {
        event,
        source: CalendarEventSource::Outlook(ProviderEventSource {
            automatic_decline: if master["showAs"].as_str() == Some("oof") {
                master_preferences
                    .get("automaticDecline")
                    .cloned()
                    .map(serde_json::from_value)
                    .transpose()
                    .map_err(|_| invalid())?
            } else {
                None
            },
            binding: target.binding,
            email_link_id: target.email_link_id,
            account_id: target.account_id,
            calendar_id: target.calendar_id,
            observed_access_role: target.observed_access_role.clone(),
            provider_event_id: string(&master, "id")?.into(),
            provider_recurring_event_id: None,
            provider_etag: master["@odata.etag"].as_str().map(str::to_owned),
            raw_payload: master,
        }),
        overrides,
        occurrences: occurrences.into_values().collect(),
    })
}

pub(super) fn preferences(event: &Value) -> Value {
    event["singleValueExtendedProperties"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|v| v["id"].as_str() == Some(PREFERENCES_ID))
        .and_then(|v| v["value"].as_str())
        .and_then(|v| serde_json::from_str(v).ok())
        .unwrap_or_else(|| json!({}))
}

pub(super) fn time_body(
    time: &EventTime,
) -> Result<(Value, Value, NaiveDate, String), CalendarProviderError> {
    match time {
        EventTime::Timed {
            starts_at,
            ends_at,
            time_zone,
        } => {
            let zone = zones::zone(time_zone.as_deref().unwrap_or("UTC"))
                .ok_or_else(|| unsupported("Choose a supported event time zone"))?;
            Ok((
                json!({"dateTime":starts_at.with_timezone(&zone).format("%Y-%m-%dT%H:%M:%S").to_string(), "timeZone":zone.name()}),
                json!({"dateTime":ends_at.with_timezone(&zone).format("%Y-%m-%dT%H:%M:%S").to_string(), "timeZone":zone.name()}),
                starts_at.with_timezone(&zone).date_naive(),
                zone.name().into(),
            ))
        }
        EventTime::AllDay {
            start_date,
            end_date,
        } => Ok((
            json!({"dateTime":format!("{start_date}T00:00:00"),"timeZone":"UTC"}),
            json!({"dateTime":format!("{end_date}T00:00:00"),"timeZone":"UTC"}),
            *start_date,
            "UTC".into(),
        )),
    }
}

fn sequence(event: &Value) -> Option<u32> {
    event["singleValueExtendedProperties"]
        .as_array()?
        .iter()
        .find(|property| {
            property["id"]
                .as_str()
                .is_some_and(|id| id.eq_ignore_ascii_case(APPOINTMENT_SEQUENCE_ID))
        })?["value"]
        .as_str()?
        .parse()
        .ok()
}
