//! Date axes (`c:dateAx`): categories positioned by date in a base time
//! unit, with labels every `majorUnit` × `majorTimeUnit` from the axis start.

use super::model::{AxisModel, DataRef};
use super::numfmt::serial_to_date;

/// Most labels generated along a date axis.
const MAX_LABELS: usize = 1000;

/// A calendar unit.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum TimeUnit {
    Days,
    Months,
    Years,
}

impl TimeUnit {
    pub fn parse(v: Option<&str>) -> Option<TimeUnit> {
        match v? {
            "days" => Some(TimeUnit::Days),
            "months" => Some(TimeUnit::Months),
            "years" => Some(TimeUnit::Years),
            _ => None,
        }
    }
}

/// A date axis laid out in base units.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct DateAxis {
    /// Each category's position in base units.
    pub units: Vec<Option<f64>>,
    /// Axis start and end in base units.
    pub min: f64,
    pub max: f64,
    /// Axis start as a serial date (labels count from it).
    pub start: f64,
    pub end: f64,
    pub base: TimeUnit,
    pub between: bool,
    pub date1904: bool,
}

/// Days since 1970-01-01 of a civil date (inverse of the serial conversion).
fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = i64::from((m + 9) % 12);
    let doy = (153 * mp + 2) / 5 + i64::from(d) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// The serial date of a civil date.
fn serial(y: i64, m: u32, d: u32, date1904: bool) -> f64 {
    let unix = days_from_civil(y, m, d);
    (if date1904 {
        unix + 24_107
    } else {
        unix + 25_569
    }) as f64
}

fn days_in_month(y: i64, m: u32) -> u32 {
    match m {
        2 if (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

/// `serial` plus `n` calendar months (the day clamped to the month's length).
fn add_months(s: f64, n: i64, date1904: bool) -> Option<f64> {
    let (y, m, d, _) = serial_to_date(s, date1904)?;
    // A huge axis step stops the labels instead of overflowing.
    let total = (y * 12 + i64::from(m) - 1).checked_add(n)?;
    if !(0..=12 * 10_000).contains(&total) {
        return None;
    }
    let (ny, nm) = (total.div_euclid(12), (total.rem_euclid(12) + 1) as u32);
    Some(serial(ny, nm, d.clamp(1, days_in_month(ny, nm)), date1904))
}

/// A serial date in base units.
fn to_unit(s: f64, base: TimeUnit, date1904: bool) -> Option<f64> {
    match base {
        TimeUnit::Days => Some(s.floor()),
        TimeUnit::Months => {
            serial_to_date(s, date1904).map(|(y, m, _, _)| (y * 12 + i64::from(m) - 1) as f64)
        }
        TimeUnit::Years => serial_to_date(s, date1904).map(|(y, _, _, _)| y as f64),
    }
}

impl DateAxis {
    /// Builds a date axis from numeric categories; `None` when they are not dates.
    pub fn new(
        cats: &DataRef,
        model: &AxisModel,
        base: Option<TimeUnit>,
        between: bool,
        date1904: bool,
    ) -> Option<DateAxis> {
        let dates: Vec<f64> = cats
            .nums
            .iter()
            .flatten()
            .copied()
            .filter(|v| (1.0..2_958_466.0).contains(v))
            .collect();
        if !cats.numeric || dates.is_empty() {
            return None;
        }
        let base = base.unwrap_or_else(|| {
            let mut sorted = dates.clone();
            sorted.sort_by(f64::total_cmp);
            let step = sorted
                .windows(2)
                .map(|w| w[1] - w[0])
                .filter(|d| *d > 0.0)
                .fold(f64::INFINITY, f64::min);
            if step < 28.0 {
                TimeUnit::Days
            } else if step < 365.0 {
                TimeUnit::Months
            } else {
                TimeUnit::Years
            }
        });
        let lo = dates.iter().copied().fold(f64::INFINITY, f64::min);
        let hi = dates.iter().copied().fold(f64::NEG_INFINITY, f64::max);
        let start = model.min.filter(|v| *v >= 1.0).unwrap_or(lo);
        let end = model.max.filter(|v| *v >= start).unwrap_or(hi.max(start));
        let units = cats
            .nums
            .iter()
            .map(|v| v.and_then(|s| to_unit(s, base, date1904)))
            .collect();
        let min = to_unit(start, base, date1904)?;
        let max = to_unit(end, base, date1904)?.max(min);
        Some(DateAxis {
            units,
            min,
            max,
            start,
            end,
            base,
            between,
            date1904,
        })
    }

    /// Fraction along the axis of a position in base units.
    pub fn t(&self, u: f64) -> f64 {
        let span = self.max - self.min;
        if self.between {
            (u - self.min + 0.5) / (span + 1.0)
        } else if span > 0.0 {
            (u - self.min) / span
        } else {
            0.5
        }
    }

    /// Fraction along the axis of category `i`.
    pub fn cat_t(&self, i: usize) -> f64 {
        self.units
            .get(i)
            .copied()
            .flatten()
            .map_or(-1.0, |u| self.t(u))
    }

    /// Fraction along the axis of a serial date.
    pub fn date_t(&self, s: f64) -> f64 {
        to_unit(s, self.base, self.date1904).map_or(0.0, |u| self.t(u))
    }

    /// Width of one base unit as a fraction of the axis.
    pub fn slot(&self) -> f64 {
        let span = self.max - self.min;
        if self.between {
            1.0 / (span + 1.0)
        } else {
            1.0 / span.max(1.0)
        }
    }

    /// Serial dates of the major labels: every `step` × `unit` from the axis start.
    pub fn label_dates(&self, step: f64, unit: TimeUnit) -> Vec<f64> {
        let mut out = Vec::new();
        let step = step.max(1.0);
        for k in 0..MAX_LABELS {
            let n = (k as f64 * step).round() as i64;
            let s = match unit {
                TimeUnit::Days => Some(self.start + n as f64),
                TimeUnit::Months => add_months(self.start, n, self.date1904),
                TimeUnit::Years => n
                    .checked_mul(12)
                    .and_then(|n| add_months(self.start, n, self.date1904)),
            };
            let Some(s) = s else { break };
            if s > self.end + 0.5 {
                break;
            }
            out.push(s);
        }
        out
    }

    /// The major step from the axis settings, else the smallest that fits
    /// `max_labels` labels.
    pub fn major(
        &self,
        model: &AxisModel,
        major_unit: Option<TimeUnit>,
        max_labels: usize,
    ) -> (f64, TimeUnit) {
        if let Some(u) = model.major_unit {
            return (u, major_unit.unwrap_or(self.base));
        }
        let span = (self.max - self.min).max(1.0);
        let max_labels = max_labels.max(1) as f64;
        let nice: &[f64] = match self.base {
            TimeUnit::Months => &[1.0, 2.0, 3.0, 6.0, 12.0, 24.0, 60.0, 120.0],
            _ => &[
                1.0, 2.0, 5.0, 7.0, 10.0, 14.0, 30.0, 50.0, 100.0, 365.0, 1000.0,
            ],
        };
        let step = nice
            .iter()
            .copied()
            .find(|s| span / s + 1.0 <= max_labels)
            .unwrap_or_else(|| (span / max_labels).ceil());
        (step, self.base)
    }
}
