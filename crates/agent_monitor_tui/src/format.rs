//! Short number, money, age and text forms for dense cells.

use chrono::TimeDelta;
use ratatui::style::{Color, Style};
use ratatui::text::Span;

use agent_monitor::domain::model::Cost;

use crate::theme;

/// An age or duration in its largest unit: `42s`, `12m`, `3h`, `2d`.
pub fn age(delta: TimeDelta) -> String {
    let seconds = delta.num_seconds().max(0);
    match seconds {
        0..60 => format!("{seconds}s"),
        60..3600 => format!("{}m", seconds / 60),
        3600..86_400 => format!("{}h", seconds / 3600),
        _ => format!("{}d", seconds / 86_400),
    }
}

/// A duration with two units: `1h04m`, `12m30s`, `45s`.
pub fn duration(delta: TimeDelta) -> String {
    let seconds = delta.num_seconds().max(0);
    let (hours, minutes, rest) = (seconds / 3600, (seconds / 60) % 60, seconds % 60);
    if hours > 0 {
        format!("{hours}h{minutes:02}m")
    } else if minutes > 0 {
        format!("{minutes}m{rest:02}s")
    } else {
        format!("{rest}s")
    }
}

/// A cost: `$3.10`, `~$0.92` for an estimate, `—` when unpriced. Never `$0`
/// for an unknown cost.
pub fn cost(cost: Cost) -> String {
    match cost {
        Cost::Known(usd) => format!("${}", money(usd)),
        Cost::Estimated(usd) => format!("~${}", money(usd)),
        Cost::Unpriced => String::from("—"),
    }
}

fn money(usd: f64) -> String {
    if usd >= 1000.0 {
        format!("{:.1}k", usd / 1000.0)
    } else if usd >= 100.0 {
        format!("{usd:.0}")
    } else {
        format!("{usd:.2}")
    }
}

/// An integer with thousands separators: `18,331`.
pub fn thousands(value: u64) -> String {
    let digits = value.to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index).is_multiple_of(3) {
            out.push(',');
        }
        out.push(digit);
    }
    out
}

/// A count with a unit suffix: `950`, `3.2k`, `1.4M`.
pub fn compact(value: u64) -> String {
    // Display rounding only; counts stay far below f64's exact range.
    let float = value as f64;
    match value {
        0..1000 => value.to_string(),
        1000..1_000_000 => format!("{:.1}k", float / 1e3),
        1_000_000..1_000_000_000 => format!("{:.1}M", float / 1e6),
        _ => format!("{:.1}G", float / 1e9),
    }
}

/// Clips `text` to `width` characters, ending in `…` when cut.
pub fn clip(text: &str, width: usize) -> String {
    if text.chars().count() <= width {
        return text.to_owned();
    }
    if width == 0 {
        return String::new();
    }
    let mut out: String = text.chars().take(width - 1).collect();
    out.push('…');
    out
}

/// `text` clipped and padded to exactly `width` characters.
pub fn cell(text: &str, width: usize) -> String {
    format!("{:<width$}", clip(text, width))
}

/// `text` clipped and right-aligned in `width` characters.
pub fn right(text: &str, width: usize) -> String {
    format!("{:>width$}", clip(text, width))
}

/// Eight-level bars for the last `width` values of a series, scaled to their
/// maximum: zero is a ghost baseline, anything else at least one level in
/// `color`.
pub fn spark<I: IntoIterator<Item = u64>>(values: I, width: usize, color: Color) -> Vec<Span<'static>> {
    const LEVELS: [char; 8] = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
    let values: Vec<u64> = values.into_iter().collect();
    let skip = values.len().saturating_sub(width);
    let values = values.get(skip..).unwrap_or_default();
    let max = values.iter().copied().max().unwrap_or(0);

    // Group runs of zero and non-zero cells into one span each.
    let mut spans: Vec<Span<'static>> = Vec::new();
    let mut run = String::new();
    let mut run_is_zero = true;
    for value in values {
        let is_zero = *value == 0 || max == 0;
        if is_zero != run_is_zero && !run.is_empty() {
            let style = if run_is_zero { Style::new().fg(theme::GHOST) } else { Style::new().fg(color) };
            spans.push(Span::styled(std::mem::take(&mut run), style));
        }
        run_is_zero = is_zero;
        let level = if is_zero { 0 } else { (value * 8).div_ceil(max).clamp(1, 8) - 1 };
        run.push(LEVELS.get(usize::try_from(level).unwrap_or(7)).copied().unwrap_or('█'));
    }
    if !run.is_empty() {
        let style = if run_is_zero { Style::new().fg(theme::GHOST) } else { Style::new().fg(color) };
        spans.push(Span::styled(run, style));
    }
    spans
}

/// [`spark`] over a per-minute activity series.
pub fn activity(values: &[u16], width: usize, color: Color) -> Vec<Span<'static>> {
    spark(values.iter().map(|value| u64::from(*value)), width, color)
}
