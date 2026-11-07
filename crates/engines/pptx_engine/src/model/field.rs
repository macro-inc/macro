//! Text fields (`a:fld`) PowerPoint computes when it shows a slide: slide
//! numbers and automatic dates.
//!
//! The engine renders an automatic date from the presentation's clock (see
//! [`Presentation::set_clock`](crate::Presentation::set_clock)) and falls back
//! to the text cached in the file without one, so renders stay deterministic
//! wherever no clock is set (tests, the corpus, server-side tools).

/// A local date and time, for automatic date fields.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FieldTime {
    /// Year (e.g. 2026).
    pub year: i32,
    /// Month, 1-12.
    pub month: u8,
    /// Day of the month, 1-31.
    pub day: u8,
    /// Hour, 0-23.
    pub hour: u8,
    /// Minute, 0-59.
    pub minute: u8,
    /// Second, 0-59.
    pub second: u8,
}

/// The automatic date formats (`a:fld/@type`) of PowerPoint's Header & Footer
/// dialog, in its order (US English examples for 2007-10-12 16:28:34):
/// `10/12/2007`, `Friday, October 12, 2007`, `12 October 2007`,
/// `October 12, 2007`, `12-Oct-07`, `October 07`, `Oct-07`,
/// `10/12/2007 4:28 PM`, `10/12/2007 4:28:34 PM`, `16:28`, `16:28:34`,
/// `4:28 PM`, `4:28:34 PM`.
pub const DATE_FORMATS: [&str; 13] = [
    "datetime1",
    "datetime2",
    "datetime3",
    "datetime4",
    "datetime5",
    "datetime6",
    "datetime7",
    "datetime8",
    "datetime9",
    "datetime10",
    "datetime11",
    "datetime12",
    "datetime13",
];

const MONTHS: [&str; 12] = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];

const WEEKDAYS: [&str; 7] = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
];

const SECONDS_PER_DAY: i64 = 86_400;
/// Days from 0000-03-01 to 1970-01-01 in the proleptic Gregorian calendar.
const UNIX_EPOCH_DAYS: i64 = 719_468;
const DAYS_PER_ERA: i64 = 146_097;

impl FieldTime {
    /// The time `secs` seconds after the Unix epoch, `offset_minutes` east of UTC.
    pub fn from_unix(secs: i64, offset_minutes: i32) -> Self {
        let local = secs + i64::from(offset_minutes) * 60;
        let (year, month, day) = civil_from_days(local.div_euclid(SECONDS_PER_DAY));
        let rem = local.rem_euclid(SECONDS_PER_DAY);
        Self {
            year,
            month,
            day,
            hour: (rem / 3600) as u8,
            minute: (rem / 60 % 60) as u8,
            second: (rem % 60) as u8,
        }
    }

    /// The current time in UTC. Native builds only: the browser worker passes
    /// its local time instead (`SystemTime` is unavailable there).
    #[cfg(not(target_arch = "wasm32"))]
    pub fn now_utc() -> Self {
        let secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| i64::try_from(d.as_secs()).unwrap_or(0));
        Self::from_unix(secs, 0)
    }

    /// Day of the week, 0 = Sunday.
    fn weekday(&self) -> usize {
        let days = days_from_civil(self.year, self.month, self.day);
        // 1970-01-01 was a Thursday.
        (days + 4).rem_euclid(7) as usize
    }

    /// The text the automatic date field `kind` (`datetime1`-`datetime13`, or
    /// `datetime` for the default format) shows at this time, in US English;
    /// `None` for any other kind.
    pub fn format(&self, kind: &str) -> Option<String> {
        let month = MONTHS[usize::from(self.month.clamp(1, 12) - 1)];
        let short_month = &month[..3];
        let (y, m, d) = (self.year, self.month, self.day);
        let yy = y.rem_euclid(100);
        let hour12 = match self.hour % 12 {
            0 => 12,
            h => h,
        };
        let meridiem = if self.hour < 12 { "AM" } else { "PM" };
        let (min, sec) = (self.minute, self.second);
        let text = match kind {
            "datetime" | "datetime1" => format!("{m}/{d}/{y}"),
            "datetime2" => format!("{}, {month} {d}, {y}", WEEKDAYS[self.weekday()]),
            "datetime3" => format!("{d} {month} {y}"),
            "datetime4" => format!("{month} {d}, {y}"),
            "datetime5" => format!("{d}-{short_month}-{yy:02}"),
            "datetime6" => format!("{month} {yy:02}"),
            "datetime7" => format!("{short_month}-{yy:02}"),
            "datetime8" => format!("{m}/{d}/{y} {hour12}:{min:02} {meridiem}"),
            "datetime9" => format!("{m}/{d}/{y} {hour12}:{min:02}:{sec:02} {meridiem}"),
            "datetime10" => format!("{}:{min:02}", self.hour),
            "datetime11" => format!("{}:{min:02}:{sec:02}", self.hour),
            "datetime12" => format!("{hour12}:{min:02} {meridiem}"),
            "datetime13" => format!("{hour12}:{min:02}:{sec:02} {meridiem}"),
            _ => return None,
        };
        Some(text)
    }
}

/// Year, month, and day of a count of days since 1970-01-01.
fn civil_from_days(days: i64) -> (i32, u8, u8) {
    let z = days + UNIX_EPOCH_DAYS;
    let era = z.div_euclid(DAYS_PER_ERA);
    let doe = z.rem_euclid(DAYS_PER_ERA);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    (
        i32::try_from(year).unwrap_or(i32::MAX),
        month as u8,
        day as u8,
    )
}

/// Days since 1970-01-01 of a calendar date.
fn days_from_civil(year: i32, month: u8, day: u8) -> i64 {
    let (month, day) = (i64::from(month.clamp(1, 12)), i64::from(day));
    let year = i64::from(year) - i64::from(month <= 2);
    let era = year.div_euclid(400);
    let yoe = year.rem_euclid(400);
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * DAYS_PER_ERA + doe - UNIX_EPOCH_DAYS
}

#[cfg(test)]
mod test;
