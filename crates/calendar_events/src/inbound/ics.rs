//! RFC 5545 email invitation adapter.

use std::collections::BTreeMap;

use chrono::{Duration, Utc};
use icalendar::{Calendar, CalendarDateTime, Class, Component, DatePerhapsTime, Event, EventLike};
use rootcause::Report;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::domain::models::{
    AttendeeResponseStatus, CalendarAttendee, CalendarEvent, CalendarEventOverride,
    CalendarEventSource, CalendarEventUpsert, CalendarOccurrence, EmailIcsSource, EventStart,
    EventStatus, EventTime, EventTransparency, EventVisibility, OccurrenceRange,
};

/// Errors returned while adapting an iCalendar message into the domain.
#[derive(Debug, thiserror::Error)]
pub enum IcsParseError {
    /// Input was not UTF-8.
    #[error("iCalendar input is not valid UTF-8")]
    InvalidUtf8,
    /// The calendar document was invalid.
    #[error("invalid iCalendar document: {0}")]
    InvalidCalendar(String),
    /// A VEVENT lacked a stable UID.
    #[error("iCalendar VEVENT is missing UID")]
    MissingUid,
    /// A VEVENT had an unsupported or incomplete time shape.
    #[error("iCalendar VEVENT {0} has an invalid or unsupported DTSTART/DTEND")]
    InvalidTime(String),
    /// Recurrence expansion failed.
    #[error("iCalendar VEVENT {0} has an invalid recurrence rule: {1}")]
    InvalidRecurrence(String, String),
}

#[derive(Debug)]
struct ParsedEvent {
    event: CalendarEvent,
    recurrence_id: Option<EventStart>,
    occurrences: Vec<CalendarOccurrence>,
}

/// Return the stable SHA-256 content identity used for idempotent extraction.
pub fn ics_content_hash(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    format!("{digest:x}")
}

/// Parse an iCalendar MIME part into canonical event upserts.
///
/// Multiple VEVENTs with the same UID are combined into one master plus
/// recurrence overrides. Recurrences are materialized only inside `horizon`;
/// the raw rule remains on the canonical entity for future horizon extension.
#[tracing::instrument(skip(bytes, source, horizon), err)]
pub fn parse_email_ics(
    owner_id: &str,
    source: EmailIcsSource,
    bytes: &[u8],
    horizon: &OccurrenceRange,
) -> Result<Vec<CalendarEventUpsert>, Report> {
    let input =
        std::str::from_utf8(bytes).map_err(|_| rootcause::report!(IcsParseError::InvalidUtf8))?;
    let calendar: Calendar = input.parse().map_err(|error| {
        rootcause::report!(IcsParseError::InvalidCalendar(format!("{error:?}")))
    })?;
    let method_cancel = calendar
        .property_value("METHOD")
        .is_some_and(|method| method.eq_ignore_ascii_case("CANCEL"));

    let mut by_uid: BTreeMap<String, Vec<ParsedEvent>> = BTreeMap::new();
    for event in calendar.events() {
        match parse_event(owner_id, event, horizon, method_cancel) {
            Ok(parsed) => {
                by_uid
                    .entry(parsed.event.ical_uid.clone())
                    .or_default()
                    .push(parsed);
            }
            Err(error) => {
                tracing::warn!(error = ?error, "skipping malformed VEVENT");
            }
        }
    }

    let mut upserts = Vec::with_capacity(by_uid.len());
    for (uid, mut components) in by_uid {
        components.sort_by_key(|component| component.event.sequence);
        let Some(master_index) = components
            .iter()
            .rposition(|component| component.recurrence_id.is_none())
        else {
            tracing::warn!(ical_uid = %uid, "skipping iCalendar UID without a master VEVENT");
            continue;
        };
        let master = components.remove(master_index);
        let event_id = master.event.id;
        let mut occurrences = master.occurrences;
        let mut overrides = Vec::with_capacity(components.len());

        for component in components {
            let Some(original_time) = component.recurrence_id else {
                continue;
            };
            let recurrence_id = original_time.occurrence_key();
            occurrences.retain(|occurrence| occurrence.occurrence_key != recurrence_id);
            let replacement = CalendarOccurrence {
                event_id,
                occurrence_key: recurrence_id.clone(),
                recurrence_id: Some(recurrence_id.clone()),
                time: component.event.time.clone(),
                is_cancelled: component.event.status == EventStatus::Cancelled,
            };
            if replacement.is_cancelled || replacement.time.overlaps(horizon) {
                occurrences.push(replacement);
            }
            overrides.push(CalendarEventOverride {
                recurrence_id,
                original_time,
                time: component.event.time,
                title: Some(component.event.title),
                description: component.event.description,
                location: component.event.location,
                status: Some(component.event.status),
            });
        }

        upserts.push(CalendarEventUpsert {
            event: master.event,
            source: CalendarEventSource::EmailIcs(source.clone()),
            overrides,
            occurrences,
        });
    }

    Ok(upserts)
}

fn parse_event(
    owner_id: &str,
    event: &Event,
    horizon: &OccurrenceRange,
    method_cancel: bool,
) -> Result<ParsedEvent, Report> {
    let uid = event
        .get_uid()
        .filter(|uid| !uid.trim().is_empty())
        .ok_or_else(|| rootcause::report!(IcsParseError::MissingUid))?
        .to_string();
    let time = parse_time(event, &uid)?;
    let recurrence_id = event
        .get_recurrence_id()
        .map(parse_start)
        .transpose()
        .map_err(|_| rootcause::report!(IcsParseError::InvalidTime(uid.clone())))?;
    let recurrence_lines = recurrence_lines(event);
    let id = Uuid::now_v7();
    let created_at = event.get_created().unwrap_or_else(Utc::now);
    let updated_at = event
        .get_last_modified()
        .or_else(|| event.get_timestamp())
        .unwrap_or(created_at);
    let sequence = event.get_sequence().unwrap_or_default();
    let organizer = event.properties().get("ORGANIZER");
    let organizer_email = organizer
        .map(|property| normalize_calendar_address(property.value()))
        .filter(|email| !email.is_empty());
    let organizer_name = organizer
        .and_then(|property| property.params().get("CN"))
        .map(|parameter| parameter.value().to_string());
    let owner_email = owner_id
        .rsplit_once('|')
        .map(|(_, email)| email.to_ascii_lowercase());
    let attendees = parse_attendees(event, organizer_email.as_deref(), owner_email.as_deref());

    let status = if method_cancel {
        EventStatus::Cancelled
    } else {
        parse_status(event.property_value("STATUS"))
    };
    let canonical = CalendarEvent {
        id,
        owner_id: owner_id.to_string(),
        ical_uid: uid.clone(),
        title: event.get_summary().unwrap_or_default().to_string(),
        description: event.get_description().map(ToOwned::to_owned),
        location: event.get_location().map(ToOwned::to_owned),
        status,
        visibility: parse_visibility(event.get_class()),
        transparency: parse_transparency(event.property_value("TRANSP")),
        time: time.clone(),
        recurrence_lines,
        organizer_email,
        organizer_name,
        conference_url: conference_url(event),
        sequence,
        is_read_only: true,
        attendees,
        created_at,
        updated_at,
    };

    let occurrences = if recurrence_id.is_some() {
        Vec::new()
    } else {
        materialize_occurrences(
            event,
            id,
            &uid,
            &time,
            horizon,
            status == EventStatus::Cancelled,
        )?
    };

    Ok(ParsedEvent {
        event: canonical,
        recurrence_id,
        occurrences,
    })
}

fn parse_time(event: &Event, uid: &str) -> Result<EventTime, Report> {
    let start = event
        .get_start()
        .ok_or_else(|| rootcause::report!(IcsParseError::InvalidTime(uid.to_string())))?;
    let end = event.get_end();

    match (start, end) {
        (DatePerhapsTime::Date(start_date), Some(DatePerhapsTime::Date(end_date)))
            if end_date > start_date =>
        {
            Ok(EventTime::AllDay {
                start_date,
                end_date,
            })
        }
        // RFC 5545 gives an all-day VEVENT without DTEND a one-day duration.
        (DatePerhapsTime::Date(start_date), None) => Ok(EventTime::AllDay {
            start_date,
            end_date: start_date + Duration::days(1),
        }),
        // RFC 5545 also allows a timed VEVENT to carry DURATION instead of
        // DTEND; instants with neither stay rejected since a zero-length
        // span cannot materialize an occurrence.
        (DatePerhapsTime::DateTime(start), None) => {
            let duration = event
                .properties()
                .get("DURATION")
                .and_then(|property| parse_ical_duration(property.value()))
                .ok_or_else(|| rootcause::report!(IcsParseError::InvalidTime(uid.to_string())))?;
            let time_zone = timezone_id(&start);
            let starts_at = start
                .try_into_utc()
                .ok_or_else(|| rootcause::report!(IcsParseError::InvalidTime(uid.to_string())))?;
            let ends_at = starts_at + duration;
            if ends_at <= starts_at {
                return Err(rootcause::report!(IcsParseError::InvalidTime(uid.to_string())).into());
            }
            Ok(EventTime::Timed {
                starts_at,
                ends_at,
                time_zone,
            })
        }
        (DatePerhapsTime::DateTime(start), Some(DatePerhapsTime::DateTime(end))) => {
            let time_zone = timezone_id(&start);
            let starts_at = start
                .try_into_utc()
                .ok_or_else(|| rootcause::report!(IcsParseError::InvalidTime(uid.to_string())))?;
            let ends_at = end
                .try_into_utc()
                .ok_or_else(|| rootcause::report!(IcsParseError::InvalidTime(uid.to_string())))?;
            if ends_at <= starts_at {
                return Err(rootcause::report!(IcsParseError::InvalidTime(uid.to_string())).into());
            }
            Ok(EventTime::Timed {
                starts_at,
                ends_at,
                time_zone,
            })
        }
        _ => Err(rootcause::report!(IcsParseError::InvalidTime(uid.to_string())).into()),
    }
}

/// Parse an RFC 5545 DURATION value (`P2W`, `P1DT2H30M`, `PT45M`, ...).
fn parse_ical_duration(value: &str) -> Option<Duration> {
    let value = value.trim();
    let (sign, rest) = match value.strip_prefix('-') {
        Some(rest) => (-1, rest),
        None => (1, value.strip_prefix('+').unwrap_or(value)),
    };
    let rest = rest.strip_prefix('P')?;
    if let Some(weeks) = rest.strip_suffix('W') {
        let weeks: i64 = weeks.parse().ok()?;
        return Some(Duration::seconds(sign * weeks * 7 * 86_400));
    }
    let (date_part, time_part) = match rest.split_once('T') {
        Some((date_part, time_part)) => (date_part, time_part),
        None => (rest, ""),
    };
    let mut seconds: i64 = 0;
    let mut digits = String::new();
    for ch in date_part.chars() {
        if ch.is_ascii_digit() {
            digits.push(ch);
        } else if ch == 'D' {
            seconds += digits.parse::<i64>().ok()? * 86_400;
            digits.clear();
        } else {
            return None;
        }
    }
    if !digits.is_empty() {
        return None;
    }
    for ch in time_part.chars() {
        if ch.is_ascii_digit() {
            digits.push(ch);
        } else {
            let unit: i64 = match ch {
                'H' => 3_600,
                'M' => 60,
                'S' => 1,
                _ => return None,
            };
            seconds += digits.parse::<i64>().ok()? * unit;
            digits.clear();
        }
    }
    if !digits.is_empty() {
        return None;
    }
    Some(Duration::seconds(sign * seconds))
}

fn parse_start(value: DatePerhapsTime) -> Result<EventStart, ()> {
    match value {
        DatePerhapsTime::Date(date) => Ok(EventStart::AllDay(date)),
        DatePerhapsTime::DateTime(date_time) => {
            date_time.try_into_utc().map(EventStart::Timed).ok_or(())
        }
    }
}

fn timezone_id(value: &CalendarDateTime) -> Option<String> {
    match value {
        CalendarDateTime::Utc(_) => Some("UTC".to_string()),
        CalendarDateTime::WithTimezone { tzid, .. } => Some(tzid.clone()),
        CalendarDateTime::Floating(_) => None,
    }
}

/// Whether the VEVENT carries a recurrence rule or date set in either of
/// `icalendar`'s property maps — repeated properties land in the multi map,
/// so checking a single map per key silently drops whole series.
fn declares_recurrence(event: &Event) -> bool {
    ["RRULE", "RDATE"].iter().any(|key| {
        event.properties().contains_key(*key)
            || event
                .multi_properties()
                .get(*key)
                .is_some_and(|properties| !properties.is_empty())
    })
}

fn recurrence_lines(event: &Event) -> Vec<String> {
    let mut lines = Vec::new();
    for key in ["RRULE", "RDATE", "EXDATE"] {
        if let Some(property) = event.properties().get(key) {
            lines.push(format!("{key}:{}", property.value()));
        }
        if let Some(properties) = event.multi_properties().get(key) {
            lines.extend(
                properties
                    .iter()
                    .map(|property| format!("{key}:{}", property.value())),
            );
        }
    }
    lines
}

fn materialize_occurrences(
    event: &Event,
    event_id: Uuid,
    uid: &str,
    event_time: &EventTime,
    horizon: &OccurrenceRange,
    is_cancelled: bool,
) -> Result<Vec<CalendarOccurrence>, Report> {
    if !declares_recurrence(event) {
        return Ok(event_time
            .overlaps(horizon)
            .then(|| CalendarOccurrence {
                event_id,
                occurrence_key: event_time.occurrence_key(),
                recurrence_id: None,
                time: event_time.clone(),
                is_cancelled,
            })
            .into_iter()
            .collect());
    }

    let recurrence = event.get_recurrence().map_err(|error| {
        rootcause::report!(IcsParseError::InvalidRecurrence(
            uid.to_string(),
            error.to_string()
        ))
    })?;
    let duration = event_duration(event_time);
    let after = horizon
        .starts_at
        .checked_sub_signed(duration)
        .unwrap_or(horizon.starts_at)
        .with_timezone(&icalendar::rrule::Tz::UTC);
    let before = horizon.ends_at.with_timezone(&icalendar::rrule::Tz::UTC);
    const MAX_MATERIALIZED_OCCURRENCES: usize = 20_000;
    let result = recurrence
        .after(after)
        .before(before)
        .all((MAX_MATERIALIZED_OCCURRENCES + 1) as u16);
    let mut dates = result.dates;
    let mut materialized_range = horizon.clone();
    if result.limited {
        let first_unmaterialized = dates.pop().ok_or_else(|| {
            rootcause::report!(IcsParseError::InvalidRecurrence(
                uid.to_string(),
                "recurrence expansion reached its safety limit before producing coverage"
                    .to_string()
            ))
        })?;
        dates.truncate(MAX_MATERIALIZED_OCCURRENCES);
        let first_unmaterialized = first_unmaterialized.with_timezone(&Utc);
        materialized_range.ends_at = materialized_range.ends_at.min(first_unmaterialized);
        materialized_range.end_date = materialized_range
            .end_date
            .min(first_unmaterialized.date_naive());
        if !materialized_range.is_valid_for_backfill() {
            return Err(rootcause::report!(IcsParseError::InvalidRecurrence(
                uid.to_string(),
                "recurrence expansion exhausted its safety limit before the requested horizon"
                    .to_string()
            ))
            .into());
        }
    }

    Ok(dates
        .into_iter()
        .filter_map(|starts| {
            let starts_at = starts.with_timezone(&Utc);
            let time = match event_time {
                EventTime::Timed { time_zone, .. } => EventTime::Timed {
                    starts_at,
                    ends_at: starts_at + duration,
                    time_zone: time_zone.clone(),
                },
                EventTime::AllDay {
                    start_date,
                    end_date,
                } => {
                    let days = *end_date - *start_date;
                    let occurrence_start = starts_at.date_naive();
                    EventTime::AllDay {
                        start_date: occurrence_start,
                        end_date: occurrence_start + days,
                    }
                }
            };
            time.overlaps(horizon).then(|| CalendarOccurrence {
                event_id,
                occurrence_key: time.occurrence_key(),
                recurrence_id: None,
                time,
                is_cancelled,
            })
        })
        .collect())
}

fn event_duration(time: &EventTime) -> Duration {
    match time {
        EventTime::Timed {
            starts_at, ends_at, ..
        } => *ends_at - *starts_at,
        EventTime::AllDay {
            start_date,
            end_date,
        } => *end_date - *start_date,
    }
}

fn normalize_calendar_address(value: &str) -> String {
    value
        .trim()
        .strip_prefix("mailto:")
        .or_else(|| value.trim().strip_prefix("MAILTO:"))
        .unwrap_or(value.trim())
        .to_ascii_lowercase()
}

fn parse_attendees(
    event: &Event,
    organizer_email: Option<&str>,
    owner_email: Option<&str>,
) -> Vec<CalendarAttendee> {
    event
        .get_attendees()
        .into_iter()
        .filter_map(|attendee| {
            let email = normalize_calendar_address(&attendee.cal_address);
            (!email.is_empty()).then(|| CalendarAttendee {
                is_organizer: organizer_email == Some(email.as_str()),
                is_self: owner_email == Some(email.as_str()),
                email,
                display_name: attendee.cn,
                response_status: match attendee
                    .part_stat
                    .map(|status| format!("{status:?}").to_ascii_lowercase())
                    .as_deref()
                {
                    Some("accepted") => AttendeeResponseStatus::Accepted,
                    Some("declined") => AttendeeResponseStatus::Declined,
                    Some("tentative") => AttendeeResponseStatus::Tentative,
                    _ => AttendeeResponseStatus::NeedsAction,
                },
                is_optional: attendee
                    .role
                    .is_some_and(|role| format!("{role:?}").eq_ignore_ascii_case("OptParticipant")),
                comment: None,
            })
        })
        .collect()
}

fn parse_status(value: Option<&str>) -> EventStatus {
    match value.map(str::to_ascii_lowercase).as_deref() {
        Some("tentative") => EventStatus::Tentative,
        Some("cancelled") => EventStatus::Cancelled,
        _ => EventStatus::Confirmed,
    }
}

fn parse_visibility(value: Option<Class>) -> EventVisibility {
    match value {
        Some(Class::Public) => EventVisibility::Public,
        Some(Class::Private) => EventVisibility::Private,
        Some(Class::Confidential) => EventVisibility::Confidential,
        _ => EventVisibility::Default,
    }
}

fn parse_transparency(value: Option<&str>) -> EventTransparency {
    if value.is_some_and(|value| value.eq_ignore_ascii_case("TRANSPARENT")) {
        EventTransparency::Transparent
    } else {
        EventTransparency::Opaque
    }
}

fn conference_url(event: &Event) -> Option<String> {
    [
        "X-GOOGLE-CONFERENCE",
        "X-MICROSOFT-SKYPETEAMSMEETINGURL",
        "URL",
    ]
    .into_iter()
    .find_map(|key| event.property_value(key).map(ToOwned::to_owned))
}

#[cfg(test)]
mod test;
