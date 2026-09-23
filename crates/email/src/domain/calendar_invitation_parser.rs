//! Bounded ICS normalization. MIME discovery and attachment downloads stay outside.

use super::models::calendar_invitation::*;
use chrono::{NaiveDate, NaiveDateTime, TimeZone, Utc};
use ical::property::Property;
use sha2::{Digest, Sha256};
use std::{collections::HashSet, io::Cursor};

/// Largest decoded part accepted for display extraction.
pub const MAX_INVITATION_BYTES: usize = 512 * 1024;
/// Largest number of scheduling components retained for a message.
pub const MAX_INVITATION_COMPONENTS: usize = 32;

/// Normalize independently parsed decoded MIME parts and collapse inline/attachment
/// duplicates. A malformed part never discards valid components from another part.
pub fn parse_invitation_parts(parts: &[&[u8]]) -> ParsedInvitations {
    let mut result = ParsedInvitations::default();
    let mut seen = HashSet::new();
    for &bytes in parts.iter().take(MAX_INVITATION_COMPONENTS) {
        if bytes.len() > MAX_INVITATION_BYTES || std::str::from_utf8(bytes).is_err() {
            continue;
        }
        for calendar in ical::IcalParser::new(Cursor::new(bytes))
            .take(MAX_INVITATION_COMPONENTS)
            .flatten()
        {
            let method = match value(&calendar.properties, "METHOD")
                .map(|s| s.to_ascii_uppercase())
                .as_deref()
            {
                Some("REQUEST") => InvitationMethod::Request,
                Some("REPLY") => InvitationMethod::Reply,
                Some("CANCEL") => InvitationMethod::Cancel,
                Some("COUNTER") => InvitationMethod::Counter,
                Some("PUBLISH") => InvitationMethod::Publish,
                _ => InvitationMethod::Unknown,
            };
            for event in calendar.events {
                if result.invitations.len() >= MAX_INVITATION_COMPONENTS {
                    break;
                }
                let props = &event.properties;
                let Some(uid) = value(props, "UID").filter(|s| !s.is_empty()) else {
                    continue;
                };
                // Normalize property order, retaining all parameters and values. Different
                // revisions and instance overrides must not collapse into a master.
                let mut identity: Vec<_> = props.iter().map(raw_property).collect();
                identity.sort();
                let id = format!(
                    "{:x}",
                    Sha256::digest(format!("{method:?}\n{}", identity.join("\n")))
                );
                if !seen.insert(id.clone()) {
                    continue;
                }
                let start = property(props, "DTSTART").and_then(parse_date);
                let end = property(props, "DTEND").and_then(parse_date).or_else(|| {
                    end_from_duration(start.as_ref()?, value(props, "DURATION")?.as_str())
                });
                let location = text_value(props, "LOCATION");
                let description = text_value(props, "DESCRIPTION");
                let conference_url = value(props, "X-GOOGLE-CONFERENCE")
                    .and_then(|v| safe_url(&v))
                    .or_else(|| value(props, "CONFERENCE").and_then(|v| safe_url(&v)))
                    .or_else(|| location.as_deref().and_then(conference_url))
                    .or_else(|| description.as_deref().and_then(conference_url));
                result.invitations.push(CalendarInvitation {
                    id,
                    uid,
                    method,
                    sequence: value(props, "SEQUENCE")
                        .and_then(|v| v.parse().ok())
                        .unwrap_or(0),
                    dtstamp: value(props, "DTSTAMP"),
                    last_modified: value(props, "LAST-MODIFIED"),
                    status: value(props, "STATUS").map(|s| s.to_ascii_uppercase()),
                    recurrence_id: property(props, "RECURRENCE-ID").and_then(parse_date),
                    recurrence_id_raw: property(props, "RECURRENCE-ID").map(raw_property),
                    title: text_value(props, "SUMMARY"),
                    organizer: property(props, "ORGANIZER").and_then(participant),
                    attendees: props
                        .iter()
                        .filter(|p| p.name.eq_ignore_ascii_case("ATTENDEE"))
                        .filter_map(participant)
                        .collect(),
                    comment: text_value(props, "COMMENT"),
                    location,
                    description,
                    start,
                    end,
                    conference_url,
                });
            }
        }
    }
    result.status = if !result.invitations.is_empty() {
        InvitationExtractionStatus::Ready
    } else if parts.is_empty() {
        InvitationExtractionStatus::Absent
    } else {
        InvitationExtractionStatus::Unsupported
    };
    result
}

fn property<'a>(props: &'a [Property], name: &str) -> Option<&'a Property> {
    props.iter().find(|p| p.name.eq_ignore_ascii_case(name))
}
fn value(props: &[Property], name: &str) -> Option<String> {
    property(props, name).and_then(|p| p.value.clone())
}
fn text_value(props: &[Property], name: &str) -> Option<String> {
    value(props, name).map(|v| unescape_text(&v))
}
fn parameter<'a>(p: &'a Property, key: &str) -> Option<&'a str> {
    p.params
        .as_ref()?
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case(key))?
        .1
        .first()
        .map(String::as_str)
}
fn participant(p: &Property) -> Option<InvitationParticipant> {
    let address = p.value.as_deref()?;
    let (scheme, email) = address.split_once(':')?;
    if !scheme.eq_ignore_ascii_case("mailto") || !email.contains('@') {
        return None;
    }
    Some(InvitationParticipant {
        email: email.to_owned(),
        name: parameter(p, "CN").map(unescape_text),
        participation_status: parameter(p, "PARTSTAT").map(str::to_ascii_uppercase),
    })
}
fn parse_date(p: &Property) -> Option<InvitationDateTime> {
    let raw = p.value.as_deref()?;
    if parameter(p, "VALUE").is_some_and(|v| v.eq_ignore_ascii_case("DATE")) || raw.len() == 8 {
        return NaiveDate::parse_from_str(raw, "%Y%m%d")
            .ok()
            .map(|v| InvitationDateTime::Date {
                value: v.to_string(),
            });
    }
    let local = NaiveDateTime::parse_from_str(raw.trim_end_matches('Z'), "%Y%m%dT%H%M%S").ok()?;
    let local_string = local.format("%Y-%m-%dT%H:%M:%S").to_string();
    let zone = parameter(p, "TZID");
    let instant = if raw.ends_with('Z') {
        Some(Utc.from_utc_datetime(&local))
    } else {
        zone.and_then(|z| z.parse::<chrono_tz::Tz>().ok())
            .and_then(|tz| tz.from_local_datetime(&local).single())
            .map(|d| d.with_timezone(&Utc))
    };
    Some(match instant {
        Some(instant) => InvitationDateTime::Zoned {
            value: instant.to_rfc3339(),
            time_zone: zone.unwrap_or("UTC").to_owned(),
            local: local_string,
        },
        None => InvitationDateTime::Unresolved {
            value: local_string,
            time_zone: zone.map(str::to_owned),
        },
    })
}
fn raw_property(p: &Property) -> String {
    let mut raw = p.name.clone();
    for (name, values) in p.params.iter().flatten() {
        raw.push(';');
        raw.push_str(name);
        raw.push('=');
        raw.push_str(&values.join(","));
    }
    raw.push(':');
    raw.push_str(p.value.as_deref().unwrap_or_default());
    raw
}
fn unescape_text(text: &str) -> String {
    let mut chars = text.chars();
    let mut output = String::with_capacity(text.len());
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('n' | 'N') => output.push('\n'),
                Some(c @ ('\\' | ',' | ';')) => output.push(c),
                Some(c) => {
                    output.push('\\');
                    output.push(c);
                }
                None => output.push('\\'),
            }
        } else {
            output.push(c);
        }
    }
    output
}
fn safe_url(raw: &str) -> Option<String> {
    let url = url::Url::parse(raw.trim()).ok()?;
    (matches!(url.scheme(), "https" | "http")
        && url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none())
    .then(|| url.to_string())
}
fn conference_url(text: &str) -> Option<String> {
    text.split_whitespace().filter_map(safe_url).find(|raw| {
        let Ok(url) = url::Url::parse(raw) else {
            return false;
        };
        matches!(
            url.host_str(),
            Some("meet.google.com" | "teams.microsoft.com" | "teams.live.com" | "zoom.us")
        ) || url.host_str().is_some_and(|h| h.ends_with(".zoom.us"))
    })
}

#[cfg(test)]
mod test;

/// RFC 5545 durations add calendar days before elapsed hours/minutes/seconds.
fn end_from_duration(start: &InvitationDateTime, raw: &str) -> Option<InvitationDateTime> {
    let raw = raw.strip_prefix('+').unwrap_or(raw).strip_prefix('P')?;
    let mut days = 0i64;
    let mut seconds = 0i64;
    let mut number = String::new();
    let mut timed = false;
    let mut last = 0;
    let mut any = false;
    for ch in raw.chars() {
        if ch.is_ascii_digit() {
            number.push(ch);
            continue;
        }
        if ch == 'T' && !timed && number.is_empty() {
            timed = true;
            continue;
        }
        let value: i64 = number.parse().ok()?;
        number.clear();
        let order = match (timed, ch) {
            (false, 'W') => 1,
            (false, 'D') => 2,
            (true, 'H') => 3,
            (true, 'M') => 4,
            (true, 'S') => 5,
            _ => return None,
        };
        if order <= last || (last == 1) {
            return None;
        }
        last = order;
        any = true;
        match ch {
            'W' => days = value.checked_mul(7)?,
            'D' => days = value,
            'H' => seconds = seconds.checked_add(value.checked_mul(3600)?)?,
            'M' => seconds = seconds.checked_add(value.checked_mul(60)?)?,
            'S' => seconds = seconds.checked_add(value)?,
            _ => return None,
        }
    }
    if !any || !number.is_empty() || raw.ends_with('T') || days > 3660 || seconds > 3660 * 86400 {
        return None;
    }
    let day_delta = chrono::TimeDelta::days(days);
    let elapsed = chrono::TimeDelta::seconds(seconds);
    match start {
        InvitationDateTime::Date { value } if seconds == 0 => Some(InvitationDateTime::Date {
            value: NaiveDate::parse_from_str(value, "%Y-%m-%d")
                .ok()?
                .checked_add_signed(day_delta)?
                .to_string(),
        }),
        InvitationDateTime::Date { .. } => None,
        InvitationDateTime::Unresolved { value, time_zone } => {
            Some(InvitationDateTime::Unresolved {
                value: NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M:%S")
                    .ok()?
                    .checked_add_signed(day_delta)?
                    .checked_add_signed(elapsed)?
                    .format("%Y-%m-%dT%H:%M:%S")
                    .to_string(),
                time_zone: time_zone.clone(),
            })
        }
        InvitationDateTime::Zoned {
            value, time_zone, ..
        } => {
            let instant = chrono::DateTime::parse_from_rfc3339(value).ok()?;
            let zone = time_zone.parse::<chrono_tz::Tz>().ok()?;
            let local = instant
                .with_timezone(&zone)
                .naive_local()
                .checked_add_signed(day_delta)?;
            let end = zone
                .from_local_datetime(&local)
                .single()?
                .checked_add_signed(elapsed)?;
            Some(InvitationDateTime::Zoned {
                value: end.with_timezone(&Utc).to_rfc3339(),
                time_zone: time_zone.clone(),
                local: end.naive_local().format("%Y-%m-%dT%H:%M:%S").to_string(),
            })
        }
    }
}
