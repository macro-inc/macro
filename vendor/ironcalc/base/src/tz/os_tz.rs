use crate::constants::EXCEL_DATE_BASE;

#[derive(Clone)]
pub(crate) struct Tz(chrono_tz::Tz);

impl Tz {
    pub(crate) fn parse(s: &str) -> Result<Tz, String> {
        s.parse::<chrono_tz::Tz>()
            .map(Tz)
            .map_err(|_| format!("Invalid timezone: {s}"))
    }
}

pub fn get_all_timezone_names() -> Vec<String> {
    chrono_tz::TZ_VARIANTS
        .iter()
        .map(|t| t.name().to_string())
        .collect()
}

pub(crate) fn excel_serial_for_now(tz: &Tz) -> Option<f64> {
    use chrono::{DateTime, Datelike, Timelike};
    let seconds = crate::model::get_milliseconds_since_epoch() / 1000;
    DateTime::from_timestamp(seconds, 0).map(|dt| {
        let local = dt.with_timezone(&tz.0);
        let days = local.num_days_from_ce() - EXCEL_DATE_BASE;
        let fraction = local.num_seconds_from_midnight() as f64 / (60.0 * 60.0 * 24.0);
        days as f64 + fraction
    })
}
