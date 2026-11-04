//! Exact mappings for the recurrence patterns supported by Microsoft Graph.
use super::*;
use chrono::{Datelike, NaiveDate, TimeZone};
use std::collections::BTreeMap;

const DAYS: [(&str, &str); 7] = [
    ("SU", "sunday"),
    ("MO", "monday"),
    ("TU", "tuesday"),
    ("WE", "wednesday"),
    ("TH", "thursday"),
    ("FR", "friday"),
    ("SA", "saturday"),
];
const INDICES: [(&str, &str); 5] = [
    ("1", "first"),
    ("2", "second"),
    ("3", "third"),
    ("4", "fourth"),
    ("-1", "last"),
];

pub(super) fn from_graph(event: &Value) -> Result<Vec<String>, CalendarProviderError> {
    let recurrence = &event["recurrence"];
    if recurrence.is_null() {
        return Ok(vec![]);
    }
    let p = &recurrence["pattern"];
    let r = &recurrence["range"];
    let kind = string(p, "type")?;
    let (_, _, start, _) = normalize::time_body(&normalize::event_time(event)?)?;
    let frequency = match kind {
        "daily" => "DAILY",
        "weekly" => "WEEKLY",
        "absoluteMonthly" | "relativeMonthly" => "MONTHLY",
        "absoluteYearly" | "relativeYearly" => "YEARLY",
        _ => return Err(invalid()),
    };
    let mut fields = vec![
        format!("FREQ={frequency}"),
        format!(
            "INTERVAL={}",
            p["interval"]
                .as_u64()
                .filter(|n| *n > 0)
                .ok_or_else(invalid)?
        ),
    ];
    if matches!(kind, "weekly" | "relativeMonthly" | "relativeYearly") {
        let days: Vec<_> = p["daysOfWeek"]
            .as_array()
            .ok_or_else(invalid)?
            .iter()
            .map(|v| {
                DAYS.iter()
                    .find(|d| Some(d.1) == v.as_str())
                    .map(|d| d.0)
                    .ok_or_else(invalid)
            })
            .collect::<Result<_, _>>()?;
        if days.is_empty() {
            return Err(invalid());
        }
        if !kind.starts_with("relative") {
            fields.push(format!("BYDAY={}", days.join(",")));
        }
        if kind.starts_with("relative") {
            let index = INDICES
                .iter()
                .find(|i| Some(i.1) == p["index"].as_str())
                .ok_or_else(invalid)?
                .0;
            if days.len() == 1 {
                fields.push(format!("BYDAY={index}{}", days[0]));
            } else {
                fields.push(format!("BYDAY={}", days.join(",")));
                fields.push(format!("BYSETPOS={index}"));
            }
        }
    }
    if kind.starts_with("absolute") {
        let day = p["dayOfMonth"]
            .as_u64()
            .filter(|n| (1..=31).contains(n))
            .ok_or_else(invalid)?;
        // A DTSTART-aligned pattern is the same rule the shared editor emits.
        // Keep explicit selectors only when omitting them would change dates.
        if day != u64::from(start.day()) {
            fields.push(format!("BYMONTHDAY={day}"));
        }
    }
    if frequency == "YEARLY" {
        let month = p["month"]
            .as_u64()
            .filter(|n| (1..=12).contains(n))
            .ok_or_else(invalid)?;
        if month != u64::from(start.month()) {
            fields.push(format!("BYMONTH={month}"));
        }
    }
    if kind == "weekly" {
        let day = DAYS
            .iter()
            .find(|d| Some(d.1) == p["firstDayOfWeek"].as_str())
            .map(|d| d.0)
            .unwrap_or("SU");
        fields.push(format!("WKST={day}"));
    }
    match string(r, "type")? {
        "numbered" => fields.push(format!(
            "COUNT={}",
            r["numberOfOccurrences"]
                .as_u64()
                .filter(|n| *n > 0)
                .ok_or_else(invalid)?
        )),
        "endDate" => {
            let date = NaiveDate::parse_from_str(string(r, "endDate")?, "%Y-%m-%d")
                .map_err(|_| invalid())?;
            if event["isAllDay"].as_bool() == Some(true) {
                fields.push(format!("UNTIL={}", date.format("%Y%m%d")));
            } else {
                let zone = zones::zone(
                    r["recurrenceTimeZone"]
                        .as_str()
                        .or(event["originalStartTimeZone"].as_str())
                        .unwrap_or("UTC"),
                )
                .ok_or_else(invalid)?;
                let end = zone
                    .from_local_datetime(&date.and_hms_opt(23, 59, 59).ok_or_else(invalid)?)
                    .single()
                    .ok_or_else(invalid)?;
                fields.push(format!(
                    "UNTIL={}",
                    end.with_timezone(&chrono::Utc).format("%Y%m%dT%H%M%SZ")
                ));
            }
        }
        "noEnd" => {}
        _ => return Err(invalid()),
    }
    Ok(vec![format!("RRULE:{}", fields.join(";"))])
}

pub(super) fn to_graph(lines: &[String], time: &EventTime) -> Result<Value, CalendarProviderError> {
    if lines.is_empty() {
        return Ok(Value::Null);
    }
    let error = || {
        unsupported(
            "This recurrence cannot be represented by Outlook. Choose a daily, weekly, monthly, or yearly pattern.",
        )
    };
    if lines.len() != 1 {
        return Err(error());
    }
    let line = lines[0].strip_prefix("RRULE:").ok_or_else(error)?;
    let mut fields = BTreeMap::new();
    for part in line.split(';') {
        let (key, value) = part.split_once('=').ok_or_else(error)?;
        if fields.insert(key, value).is_some() {
            return Err(error());
        }
    }
    if fields.keys().any(|k| {
        ![
            "FREQ",
            "INTERVAL",
            "BYDAY",
            "BYMONTHDAY",
            "BYMONTH",
            "BYSETPOS",
            "WKST",
            "COUNT",
            "UNTIL",
        ]
        .contains(k)
    }) {
        return Err(error());
    }
    let frequency = *fields.get("FREQ").ok_or_else(error)?;
    let interval: u32 = fields
        .get("INTERVAL")
        .unwrap_or(&"1")
        .parse()
        .ok()
        .filter(|n| *n > 0)
        .ok_or_else(error)?;
    let (_, _, start, zone) = normalize::time_body(time)?;
    let mut p = json!({"interval":interval});
    let mut days = vec![];
    let mut ordinal = None;
    if let Some(byday) = fields.get("BYDAY") {
        for day in byday.split(',') {
            if day.len() < 2 {
                return Err(error());
            }
            let (prefix, day) = day.split_at(day.len() - 2);
            let graph = DAYS.iter().find(|d| d.0 == day).ok_or_else(error)?.1;
            if !prefix.is_empty() {
                if ordinal.is_some() || byday.contains(',') {
                    return Err(error());
                }
                ordinal = Some(prefix);
            }
            days.push(graph);
        }
    }
    if let Some(pos) = fields.get("BYSETPOS") {
        if ordinal.is_some() {
            return Err(error());
        }
        ordinal = Some(*pos);
    }
    let bymonthday = fields
        .get("BYMONTHDAY")
        .map(|v| {
            v.parse::<u32>()
                .ok()
                .filter(|n| (1..=31).contains(n))
                .ok_or_else(error)
        })
        .transpose()?;
    let bymonth = fields
        .get("BYMONTH")
        .map(|v| {
            v.parse::<u32>()
                .ok()
                .filter(|n| (1..=12).contains(n))
                .ok_or_else(error)
        })
        .transpose()?;
    if frequency != "YEARLY" && bymonth.is_some() {
        return Err(error());
    }
    match frequency {
        "DAILY" if days.is_empty() && ordinal.is_none() && bymonthday.is_none() => {
            p["type"] = json!("daily")
        }
        "WEEKLY" if ordinal.is_none() && bymonthday.is_none() => {
            p["type"] = json!("weekly");
            if days.is_empty() {
                days.push(DAYS[start.weekday().num_days_from_sunday() as usize].1);
            }
            p["daysOfWeek"] = json!(days);
            p["firstDayOfWeek"] = json!(
                DAYS.iter()
                    .find(|d| d.0 == *fields.get("WKST").unwrap_or(&"MO"))
                    .ok_or_else(error)?
                    .1
            );
        }
        "MONTHLY" | "YEARLY" => {
            let relative = !days.is_empty();
            if relative {
                if bymonthday.is_some() {
                    return Err(error());
                }
                let index = INDICES
                    .iter()
                    .find(|i| Some(i.0) == ordinal)
                    .ok_or_else(error)?
                    .1;
                p["daysOfWeek"] = json!(days);
                p["index"] = json!(index);
            } else {
                if ordinal.is_some() {
                    return Err(error());
                }
                p["dayOfMonth"] = json!(bymonthday.unwrap_or(start.day()));
            }
            p["type"] = json!(match (frequency, relative) {
                ("MONTHLY", true) => "relativeMonthly",
                ("MONTHLY", false) => "absoluteMonthly",
                (_, true) => "relativeYearly",
                (_, false) => "absoluteYearly",
            });
            if frequency == "YEARLY" {
                p["month"] = json!(bymonth.unwrap_or(start.month()));
            }
        }
        _ => return Err(error()),
    }
    let mut r = json!({"type":"noEnd","startDate":start.to_string(),"recurrenceTimeZone":zone});
    if let Some(count) = fields.get("COUNT") {
        if fields.contains_key("UNTIL") {
            return Err(error());
        }
        r["type"] = json!("numbered");
        r["numberOfOccurrences"] = json!(
            count
                .parse::<u32>()
                .ok()
                .filter(|n| *n > 0)
                .ok_or_else(error)?
        );
    }
    if let Some(until) = fields.get("UNTIL") {
        let date = if until.len() == 8 {
            NaiveDate::parse_from_str(until, "%Y%m%d").map_err(|_| error())?
        } else {
            let zone = zones::zone(&zone).ok_or_else(error)?;
            let bound = chrono::NaiveDateTime::parse_from_str(until, "%Y%m%dT%H%M%SZ")
                .map_err(|_| error())?
                .and_utc()
                .with_timezone(&zone);
            let date = bound.date_naive();
            // Graph endDate includes the whole date; RFC UNTIL includes only
            // starts at or before its instant. Exclude a later start that day.
            if let EventTime::Timed { starts_at, .. } = time
                && bound.time() < starts_at.with_timezone(&zone).time()
            {
                date.pred_opt().ok_or_else(error)?
            } else {
                date
            }
        };
        if date < start {
            return Err(error());
        }
        r["type"] = json!("endDate");
        r["endDate"] = json!(date.to_string());
    }
    Ok(json!({"pattern":p,"range":r}))
}
