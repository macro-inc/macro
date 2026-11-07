//! The current time a prompt states, in the time zone of its reader.

use chrono::{DateTime, Utc};
use chrono_tz::Tz;

#[cfg(test)]
mod test;

/// Now, as a prompt states it: models do not know the date, so relative
/// dates and date chips are resolved from this.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CurrentTime {
    /// ISO 8601 timestamp carrying the zone's UTC offset.
    pub iso: String,
    /// The same instant written out, e.g. "Thursday, September 24, 2026, 4:03 PM".
    pub local: String,
    /// The IANA zone, absent when unknown and the time is in UTC.
    pub time_zone: Option<String>,
}

impl CurrentTime {
    /// `now` in `time_zone`, or in UTC when the zone is unknown or not a
    /// valid IANA name.
    pub fn new(now: DateTime<Utc>, time_zone: Option<&str>) -> Self {
        let zone = time_zone.and_then(|name| {
            name.parse::<Tz>()
                .inspect_err(|error| {
                    tracing::warn!(error=?error, time_zone = name, "unparseable time zone");
                })
                .ok()
        });
        match zone {
            Some(zone) => {
                let local = now.with_timezone(&zone);
                Self {
                    iso: local.to_rfc3339_opts(chrono::SecondsFormat::Secs, false),
                    local: local.format(FORMAT).to_string(),
                    time_zone: Some(zone.name().to_owned()),
                }
            }
            None => Self {
                iso: now.to_rfc3339_opts(chrono::SecondsFormat::Secs, false),
                local: now.format(FORMAT).to_string(),
                time_zone: None,
            },
        }
    }
}

const FORMAT: &str = "%A, %B %-d, %Y, %-I:%M %p";
