//! Value-axis scaling: Excel-like automatic bounds and major units.
//!
//! Excel starts a value axis at zero unless the data spans less than a sixth
//! of its maximum, leaves 5% headroom past the extreme value, and picks a
//! major unit of 1, 2, or 5 × 10ⁿ giving at most ten intervals whose labels
//! fit along the axis.

/// A resolved value scale.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Scale {
    pub min: f64,
    pub max: f64,
    /// Major unit (a multiplier on logarithmic scales).
    pub major: f64,
    /// Minor unit (a multiplier on logarithmic scales).
    pub minor: f64,
    pub log_base: Option<f64>,
}

/// Most ticks generated along one axis.
const MAX_TICKS: usize = 1000;

impl Scale {
    /// Position of `v` along the axis, `0` at `min` and `1` at `max`.
    pub fn norm(&self, v: f64) -> f64 {
        let t = match self.log_base {
            Some(b) => {
                if v <= 0.0 {
                    return -1.0;
                }
                let (lo, hi) = (self.min.log(b), self.max.log(b));
                (v.log(b) - lo) / (hi - lo)
            }
            None => (v - self.min) / (self.max - self.min),
        };
        if t.is_finite() { t } else { 0.0 }
    }

    /// Major tick values from `min` to `max`.
    pub fn ticks(&self) -> Vec<f64> {
        self.steps(self.major)
    }

    /// Minor tick values from `min` to `max`.
    pub fn minor_ticks(&self) -> Vec<f64> {
        self.steps(self.minor)
    }

    fn steps(&self, unit: f64) -> Vec<f64> {
        let mut out = Vec::new();
        match self.log_base {
            Some(_) => {
                let f = unit.max(1.0001);
                let mut v = self.min;
                while v <= self.max * (1.0 + 1e-9) && out.len() < MAX_TICKS {
                    out.push(v);
                    v *= f;
                }
            }
            None => {
                if unit <= 0.0 || !unit.is_finite() {
                    return vec![self.min, self.max];
                }
                let n = ((self.max - self.min) / unit + 1e-9).floor();
                if !(0.0..=MAX_TICKS as f64).contains(&n) {
                    return vec![self.min, self.max];
                }
                for k in 0..=n as usize {
                    let v = self.min + k as f64 * unit;
                    out.push(if v.abs() < unit * 1e-9 { 0.0 } else { clean(v) });
                }
            }
        }
        out
    }

    /// Clamps `v` into the scale's range.
    pub fn clamp(&self, v: f64) -> f64 {
        v.clamp(self.min.min(self.max), self.max.max(self.min))
    }
}

/// Rounds away binary noise (keeps 12 significant digits).
fn clean(v: f64) -> f64 {
    if v == 0.0 || !v.is_finite() {
        return v;
    }
    let mag = 10f64.powi(11 - v.abs().log10().floor() as i32);
    if !mag.is_finite() || mag == 0.0 {
        return v;
    }
    (v * mag).round() / mag
}

/// Explicit axis settings.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct Fixed {
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub major: Option<f64>,
    pub minor: Option<f64>,
    pub log_base: Option<f64>,
}

/// The candidate major units, ascending, around `raw`.
fn candidates(raw: f64) -> Vec<f64> {
    let raw = if raw.is_finite() && raw > 0.0 {
        raw
    } else {
        1.0
    };
    let start = raw.log10().floor() as i32 - 1;
    let mut out = Vec::new();
    for e in start..start + 24 {
        for m in [1.0, 2.0, 5.0] {
            out.push(clean(m * 10f64.powi(e)));
        }
    }
    out
}

/// Computes a scale for data spanning `data` (`None` = no values).
///
/// `percent` marks percent-stacked data (no headroom), and `fits` reports
/// whether labels at a candidate unit fit along the axis.
pub(crate) fn auto_scale(
    data: Option<(f64, f64)>,
    fixed: Fixed,
    percent: bool,
    max_intervals: usize,
    fits: &dyn Fn(&Scale) -> bool,
) -> Scale {
    if let Some(base) = fixed.log_base {
        return log_scale(data, fixed, base);
    }
    let (mut lo, mut hi) = data
        .filter(|(a, b)| a.is_finite() && b.is_finite())
        .unwrap_or((0.0, 1.0));
    if lo > hi {
        std::mem::swap(&mut lo, &mut hi);
    }
    // Fixed bounds replace the data extremes they constrain.
    if let Some(m) = fixed.min {
        lo = m;
        hi = hi.max(m);
    }
    if let Some(m) = fixed.max {
        hi = m;
        lo = lo.min(m);
    }
    if lo == hi {
        if fixed.min.is_some() || fixed.max.is_some() {
            let d = (lo.abs() * 0.1).max(1.0);
            if fixed.max.is_some() {
                lo -= d
            } else {
                hi += d
            }
        } else if lo == 0.0 {
            hi = 1.0;
        } else if lo > 0.0 {
            lo = 0.0;
        } else {
            hi = 0.0;
        }
    }
    // Zero inclusion: start at zero unless the values are bunched together.
    let mut zero_lo = false;
    let mut zero_hi = false;
    if fixed.min.is_none() && lo >= 0.0 && (hi - lo) / hi > 1.0 / 6.0 {
        lo = 0.0;
        zero_lo = true;
    } else if fixed.max.is_none() && hi <= 0.0 && (hi - lo) / -lo > 1.0 / 6.0 {
        hi = 0.0;
        zero_hi = true;
    }
    let range = hi - lo;
    // Headroom past the extremes.
    let (plo, phi) = if percent {
        (lo, hi)
    } else if lo >= 0.0 {
        let plo = if zero_lo {
            0.0
        } else {
            (lo - range / 2.0).max(0.0)
        };
        (plo, hi + 0.05 * range)
    } else if hi <= 0.0 {
        let phi = if zero_hi {
            0.0
        } else {
            (hi + range / 2.0).min(0.0)
        };
        (lo - 0.05 * range, phi)
    } else {
        (lo - 0.05 * lo.abs(), hi + 0.05 * hi.abs())
    };
    let plo = fixed.min.unwrap_or(plo);
    let phi = fixed
        .max
        .unwrap_or(phi)
        .max(plo + f64::EPSILON.max(plo.abs() * 1e-12));
    let bounds = |u: f64| {
        // Ticks step from a fixed minimum (or back from a fixed maximum).
        let (amin, amax) = match (fixed.min, fixed.max) {
            (Some(lo), Some(hi)) => (lo, hi),
            (Some(lo), None) => (lo, clean(lo + ((phi - lo) / u - 1e-9).ceil().max(1.0) * u)),
            (None, Some(hi)) => (clean(hi - ((hi - plo) / u - 1e-9).ceil().max(1.0) * u), hi),
            (None, None) => (
                if plo == 0.0 {
                    0.0
                } else {
                    clean((plo / u + 1e-9).floor() * u)
                },
                if phi == 0.0 {
                    0.0
                } else {
                    clean((phi / u - 1e-9).ceil() * u)
                },
            ),
        };
        (amin, if amax > amin { amax } else { amin + u })
    };
    let make = |u: f64| {
        let (min, max) = bounds(u);
        Scale {
            min,
            max,
            major: u,
            minor: fixed.minor.unwrap_or(u / 5.0),
            log_base: None,
        }
    };
    if let Some(u) = fixed.major {
        let mut u = u;
        let span = phi - plo;
        while span / u > MAX_TICKS as f64 {
            u *= 10.0;
        }
        return make(u);
    }
    let max_intervals = max_intervals.clamp(1, 10) as f64;
    let mut last = None;
    for u in candidates((phi - plo) / 10.0) {
        let s = make(u);
        let n = ((s.max - s.min) / u - 1e-9).ceil();
        if n <= max_intervals + 1e-9 && fits(&s) {
            return s;
        }
        last = Some(s);
        if n < 1.0 {
            break;
        }
    }
    last.unwrap_or_else(|| make(1.0))
}

fn log_scale(data: Option<(f64, f64)>, fixed: Fixed, base: f64) -> Scale {
    let (lo, hi) = data
        .filter(|(a, b)| *a > 0.0 && *b > 0.0 && a.is_finite() && b.is_finite())
        .unwrap_or((1.0, base));
    let floor = |v: f64| base.powf((v.log(base) + 1e-9).floor());
    let ceil = |v: f64| base.powf((v.log(base) - 1e-9).ceil());
    let min = fixed
        .min
        .filter(|m| *m > 0.0)
        .unwrap_or_else(|| floor(lo.min(hi)));
    let mut max = fixed
        .max
        .filter(|m| *m > min)
        .unwrap_or_else(|| ceil(lo.max(hi)));
    if max <= min {
        max = min * base;
    }
    let major = fixed.major.filter(|m| *m > 1.0).unwrap_or(base);
    Scale {
        min,
        max,
        major,
        minor: fixed.minor.filter(|m| *m > 1.0).unwrap_or(major),
        log_base: Some(base),
    }
}
