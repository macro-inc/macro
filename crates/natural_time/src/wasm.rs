//! [`read`](crate::read) and [`read_other_meridiem`](crate::read_other_meridiem),
//! as the browser calls them.
//!
//! The browser passes its own local wall-clock time as `now`
//! (`2026-11-06T10:00:00`), a pick (`start`, `end` or `span`) and an optional
//! default time (`09:00`). Each call returns a plain object, `{ outcome:
//! "read", start, end, assumed }` or `{ outcome: "unread", error }`, which
//! `apps/web/src/lib/core/natural-time/wasm-module.ts` types. A phrase that
//! can't be read is an outcome, not a throw; only a malformed `now`, pick or
//! default time throws.
//!
//! Only the wasm-bindgen glue lives here; the reader knows nothing of it.

use chrono::{NaiveDateTime, NaiveTime};
use serde::Serialize;
use wasm_bindgen::prelude::*;

use crate::{Assumed, Error, Moment, Pick, Reading};

/// Reads `phrase` at `now`, taking the part `pick` names.
///
/// # Errors
///
/// Throws when `now`, `pick` or `default_time` is malformed.
#[wasm_bindgen]
pub fn read(
    phrase: &str,
    now: &str,
    pick: &str,
    default_time: Option<String>,
) -> Result<JsValue, JsError> {
    let (now, pick, default_time) = inputs(now, pick, default_time.as_deref())?;
    outcome(crate::read(phrase, now, pick, default_time))
}

/// Reads `phrase` like [`read`], with a guessed am or pm the other way round.
///
/// # Errors
///
/// Throws when `now`, `pick` or `default_time` is malformed.
#[wasm_bindgen(js_name = readOtherMeridiem)]
pub fn read_other_meridiem(
    phrase: &str,
    now: &str,
    pick: &str,
    default_time: Option<String>,
) -> Result<JsValue, JsError> {
    let (now, pick, default_time) = inputs(now, pick, default_time.as_deref())?;
    outcome(crate::read_other_meridiem(phrase, now, pick, default_time))
}

fn inputs(
    now: &str,
    pick: &str,
    default_time: Option<&str>,
) -> Result<(NaiveDateTime, Pick, Option<NaiveTime>), JsError> {
    let now = NaiveDateTime::parse_from_str(now, "%Y-%m-%dT%H:%M:%S")?;
    let pick = match pick {
        "start" => Pick::Start,
        "end" => Pick::End,
        "span" => Pick::Span,
        other => return Err(JsError::new(&format!("unknown pick {other:?}"))),
    };
    let default_time = default_time
        .map(|time| NaiveTime::parse_from_str(time, "%H:%M"))
        .transpose()?;
    Ok((now, pick, default_time))
}

fn outcome(result: Result<Reading, Error>) -> Result<JsValue, JsError> {
    let outcome = match result {
        Ok(reading) => Outcome::Read {
            start: reading.start.into(),
            end: reading.end.map(Into::into),
            assumed: reading.assumed,
        },
        Err(error) => Outcome::Unread { error },
    };
    serde_wasm_bindgen::to_value(&outcome).map_err(|error| JsError::new(&error.to_string()))
}

#[derive(Serialize)]
#[serde(tag = "outcome", rename_all = "camelCase")]
enum Outcome {
    Read {
        start: MomentValue,
        end: Option<MomentValue>,
        assumed: Assumed,
    },
    Unread {
        error: Error,
    },
}

/// A [`Moment`] as the browser reads it: a date (`2026-11-13`), a local wall
/// time (`2026-11-13T15:00:00`) or elapsed minutes. Its own type because
/// [`chrono::TimeDelta`] has no serde form and an internally tagged enum can't
/// hold a bare date.
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum MomentValue {
    Day { date: String },
    At { local: String },
    After { minutes: i64 },
}

impl From<Moment> for MomentValue {
    fn from(moment: Moment) -> Self {
        match moment {
            Moment::Day(date) => Self::Day {
                date: date.format("%Y-%m-%d").to_string(),
            },
            Moment::At(at) => Self::At {
                local: at.format("%Y-%m-%dT%H:%M:%S").to_string(),
            },
            Moment::After(delta) => Self::After {
                minutes: delta.num_minutes(),
            },
        }
    }
}
