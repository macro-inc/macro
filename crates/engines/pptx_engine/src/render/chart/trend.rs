//! Trendlines (`c:trendline`): least-squares fits and moving averages drawn
//! over a series, with their equation / R² label and legend entry.

use super::canvas::Canvas;
use super::dlabel::{self, Pending};
use super::model::{
    ChartModel, GroupModel, Grouping, Kind, SeriesModel, TrendKind, TrendlineModel,
};
use super::numfmt;
use super::plot::{Mapping, Plot, x_values};
use super::style::{Role, apply, resolve_line};
use crate::model::fill::{Cap, Fill, Line, LineProps, preset_dash};
use crate::path::{Path, Point, Rect};
use crate::render::label::HAlign;

/// Samples along a curved trendline.
const SAMPLES: usize = 96;
/// Width of automatic trendlines (points).
const AUTO_WIDTH: f32 = 1.5;
/// Gap between the end of a trendline and its label (points).
const LABEL_GAP: f32 = 4.0;

/// A fitted trend `y(x)`.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Fit {
    /// `Σ c[j]·((x − shift) / scale)^j` (normalized for numerical stability).
    Poly { c: Vec<f64>, shift: f64, scale: f64 },
    /// `a·e^(b·x)`.
    Exp { a: f64, b: f64 },
    /// `a + b·ln x`.
    Log { a: f64, b: f64 },
    /// `a·x^b`.
    Power { a: f64, b: f64 },
}

impl Fit {
    /// The trend at `x`, when defined there.
    pub fn eval(&self, x: f64) -> Option<f64> {
        let y = match self {
            Fit::Poly { c, shift, scale } => {
                let t = (x - shift) / scale;
                c.iter().rev().fold(0.0, |acc, k| acc * t + k)
            }
            Fit::Exp { a, b } => a * (b * x).exp(),
            Fit::Log { a, b } if x > 0.0 => a + b * x.ln(),
            Fit::Power { a, b } if x > 0.0 => a * x.powf(*b),
            Fit::Log { .. } | Fit::Power { .. } => return None,
        };
        y.is_finite().then_some(y)
    }

    /// Polynomial coefficients in plain `x`, lowest power first.
    fn poly_coefficients(&self) -> Vec<f64> {
        let Fit::Poly { c, shift, scale } = self else {
            return Vec::new();
        };
        let mut out = vec![0.0; c.len()];
        for (j, cj) in c.iter().enumerate() {
            // cj·((x − shift)/scale)^j, expanded binomially.
            let mut binom = 1.0;
            for (l, slot) in out.iter_mut().enumerate().take(j + 1) {
                if l > 0 {
                    binom = binom * (j + 1 - l) as f64 / l as f64;
                }
                *slot += cj / scale.powi(j as i32) * binom * (-shift).powi((j - l) as i32);
            }
        }
        out
    }
}

/// Solves `a·x = b` by Gaussian elimination with partial pivoting.
fn solve(mut a: Vec<Vec<f64>>, mut b: Vec<f64>) -> Option<Vec<f64>> {
    let n = b.len();
    let size = a
        .iter()
        .flatten()
        .fold(0.0f64, |m, v| m.max(v.abs()))
        .max(f64::MIN_POSITIVE);
    for col in 0..n {
        let pivot = (col..n).max_by(|&i, &j| a[i][col].abs().total_cmp(&a[j][col].abs()))?;
        if a[pivot][col].abs() <= size * 1e-13 {
            return None;
        }
        a.swap(col, pivot);
        b.swap(col, pivot);
        for row in col + 1..n {
            let (top, bottom) = a.split_at_mut(row);
            let (pivot_row, target) = (&top[col], &mut bottom[0]);
            let f = target[col] / pivot_row[col];
            for (t, p) in target.iter_mut().zip(pivot_row).skip(col) {
                *t -= f * p;
            }
            b[row] -= f * b[col];
        }
    }
    let mut x = vec![0.0; n];
    for row in (0..n).rev() {
        let s: f64 = (row + 1..n).map(|k| a[row][k] * x[k]).sum();
        x[row] = (b[row] - s) / a[row][row];
    }
    x.iter().all(|v| v.is_finite()).then_some(x)
}

/// Least-squares coefficients of `Σ c_j·t^j` (`j` in `powers`) through `pts`.
fn least_squares(pts: &[(f64, f64)], powers: &[i32]) -> Option<Vec<f64>> {
    let n = powers.len();
    let mut a = vec![vec![0.0; n]; n];
    let mut b = vec![0.0; n];
    for &(t, y) in pts {
        for (r, &pr) in powers.iter().enumerate() {
            let tr = t.powi(pr);
            b[r] += tr * y;
            for (c, &pc) in powers.iter().enumerate() {
                a[r][c] += tr * t.powi(pc);
            }
        }
    }
    solve(a, b)
}

/// Intercept and slope of the least-squares line through `pts`.
fn line_fit(pts: &[(f64, f64)]) -> Option<(f64, f64)> {
    let ab = least_squares(pts, &[0, 1])?;
    Some((ab[0], ab[1]))
}

/// Slope of the least-squares line through `pts` forced through `(0, y0)`.
fn slope_through(pts: &[(f64, f64)], y0: f64) -> Option<f64> {
    let sxx: f64 = pts.iter().map(|(x, _)| x * x).sum();
    let sxy: f64 = pts.iter().map(|(x, y)| x * (y - y0)).sum();
    (sxx > 0.0).then(|| sxy / sxx).filter(|b| b.is_finite())
}

/// Coefficient of determination of `pred` over the observations.
fn r_squared(obs: &[(f64, f64)], pred: impl Fn(f64) -> Option<f64>) -> f64 {
    let n = obs.len().max(1) as f64;
    let mean = obs.iter().map(|(_, y)| y).sum::<f64>() / n;
    let tot: f64 = obs.iter().map(|(_, y)| (y - mean).powi(2)).sum();
    let res: f64 = obs
        .iter()
        .map(|&(x, y)| (y - pred(x).unwrap_or(mean)).powi(2))
        .sum();
    if tot > 0.0 { 1.0 - res / tot } else { 1.0 }
}

/// Fits a regression trend through `pts`, with its R².
pub(crate) fn fit(
    kind: TrendKind,
    pts: &[(f64, f64)],
    intercept: Option<f64>,
) -> Option<(Fit, f64)> {
    let ln = |v: f64| (v > 0.0).then(|| v.ln());
    let order = match kind {
        TrendKind::Linear => 1,
        TrendKind::Poly(k) => k,
        _ => 0,
    };
    if pts.len() < order.max(1) + 1 {
        return None;
    }
    match kind {
        TrendKind::Linear | TrendKind::Poly(_) => {
            let n = pts.len() as f64;
            let shift = match intercept {
                Some(_) => 0.0,
                None => pts.iter().map(|(x, _)| x).sum::<f64>() / n,
            };
            let scale = pts
                .iter()
                .map(|(x, _)| (x - shift).abs())
                .fold(0.0f64, f64::max);
            let scale = if scale > 0.0 { scale } else { 1.0 };
            let y0 = intercept.unwrap_or(0.0);
            let first = i32::from(intercept.is_some());
            let powers: Vec<i32> = (first..=order as i32).collect();
            let ts: Vec<(f64, f64)> = pts
                .iter()
                .map(|&(x, y)| ((x - shift) / scale, y - y0))
                .collect();
            let coef = least_squares(&ts, &powers)?;
            let mut c = vec![0.0; order + 1];
            c[0] = y0;
            for (&p, v) in powers.iter().zip(coef) {
                c[p as usize] += v;
            }
            let f = Fit::Poly { c, shift, scale };
            let r2 = r_squared(pts, |x| f.eval(x));
            Some((f, r2))
        }
        TrendKind::Exp => {
            let lp: Vec<(f64, f64)> = pts
                .iter()
                .map(|&(x, y)| Some((x, ln(y)?)))
                .collect::<Option<_>>()?;
            let (la, b) = match intercept {
                Some(c) => {
                    let lc = ln(c)?;
                    (lc, slope_through(&lp, lc)?)
                }
                None => line_fit(&lp)?,
            };
            let r2 = r_squared(&lp, |x| Some(la + b * x));
            Some((Fit::Exp { a: la.exp(), b }, r2))
        }
        TrendKind::Log => {
            let lp: Vec<(f64, f64)> = pts
                .iter()
                .map(|&(x, y)| Some((ln(x)?, y)))
                .collect::<Option<_>>()?;
            let (a, b) = line_fit(&lp)?;
            let r2 = r_squared(&lp, |lx| Some(a + b * lx));
            Some((Fit::Log { a, b }, r2))
        }
        TrendKind::Power => {
            let lp: Vec<(f64, f64)> = pts
                .iter()
                .map(|&(x, y)| Some((ln(x)?, ln(y)?)))
                .collect::<Option<_>>()?;
            let (la, b) = line_fit(&lp)?;
            let r2 = r_squared(&lp, |lx| Some(la + b * lx));
            Some((Fit::Power { a: la.exp(), b }, r2))
        }
        TrendKind::MovingAvg(_) => None,
    }
}

/// Excel's default coefficient text: 5 significant digits, at most 4 decimals.
fn coef_text(v: f64, fmt: Option<&str>, date1904: bool) -> String {
    if let Some(f) = fmt {
        return numfmt::format(v, f, date1904);
    }
    if v == 0.0 || !v.is_finite() {
        return "0".to_owned();
    }
    let decimals = (4 - v.abs().log10().floor() as i32).clamp(0, 4) as usize;
    let s = format!("{v:.decimals$}");
    let s = if s.contains('.') {
        s.trim_end_matches('0').trim_end_matches('.').to_owned()
    } else {
        s
    };
    if s == "-0" { "0".to_owned() } else { s }
}

/// The displayed equation of a fit, e.g. `y = 2.5x + 3`.
pub(crate) fn equation(f: &Fit, fmt: Option<&str>, date1904: bool) -> String {
    let num = |v: f64| coef_text(v, fmt, date1904);
    match f {
        Fit::Poly { .. } => {
            let c = f.poly_coefficients();
            let mut out = String::from("y =");
            let mut first = true;
            for (p, &v) in c.iter().enumerate().rev() {
                let mag = num(v.abs());
                // Terms that round to zero are left out (a lone constant stays).
                if mag == "0" && !(p == 0 && first) {
                    continue;
                }
                let sign = if v < 0.0 { "-" } else { "+" };
                let var = match p {
                    0 => String::new(),
                    1 => "x".to_owned(),
                    _ => format!("x{}", superscript(p)),
                };
                // A unit coefficient is implied: `y = x² + 1`.
                let mag = if mag == "1" && p > 0 {
                    String::new()
                } else {
                    mag
                };
                if first {
                    out.push(' ');
                    if v < 0.0 {
                        out.push('-');
                    }
                } else {
                    out.push_str(&format!(" {sign} "));
                }
                out.push_str(&mag);
                out.push_str(&var);
                first = false;
            }
            out
        }
        Fit::Exp { a, b } => format!("y = {}e^({}x)", num(*a), num(*b)),
        Fit::Log { a, b } => {
            let sign = if *a < 0.0 { "-" } else { "+" };
            format!("y = {}ln(x) {sign} {}", num(*b), num(a.abs()))
        }
        Fit::Power { a, b } => format!("y = {}x^{}", num(*a), num(*b)),
    }
}

/// Superscript digits of a small power.
fn superscript(p: usize) -> String {
    const DIGITS: [char; 10] = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];
    p.to_string()
        .bytes()
        .map(|d| DIGITS[usize::from(d - b'0') % 10])
        .collect()
}

/// Whether a group can carry trendlines (unstacked 2-D axis charts).
pub(crate) fn supported(g: &GroupModel) -> bool {
    matches!(
        g.kind,
        Kind::Bar | Kind::Line | Kind::Area | Kind::Scatter | Kind::Bubble | Kind::Stock
    ) && !matches!(g.grouping, Grouping::Stacked | Grouping::Percent)
        && !g.is_3d
}

/// The legend text of a trendline, e.g. `Linear (Sales)`.
pub(crate) fn legend_text(t: &TrendlineModel, s: &SeriesModel) -> String {
    if let Some(n) = &t.name {
        return n.clone();
    }
    let series = s
        .name
        .clone()
        .unwrap_or_else(|| format!("Series{}", s.idx + 1));
    let kind = match t.kind {
        TrendKind::Linear => "Linear".to_owned(),
        TrendKind::Exp => "Expon.".to_owned(),
        TrendKind::Log => "Log.".to_owned(),
        TrendKind::Poly(_) => "Poly.".to_owned(),
        TrendKind::Power => "Power".to_owned(),
        TrendKind::MovingAvg(p) => format!("{p} per. Mov. Avg."),
    };
    format!("{kind} ({series})")
}

/// The resolved line of a trendline (automatic: a dotted line in the series color).
pub(crate) fn line(
    m: &ChartModel,
    g: &GroupModel,
    s: &SeriesModel,
    t: &TrendlineModel,
) -> Option<Line> {
    let look = m.look(g, s, None);
    let color = look
        .line
        .as_ref()
        .and_then(|l| l.fill.representative_color())
        .filter(|_| !g.filled())
        .or_else(|| look.fill.as_ref().and_then(Fill::representative_color))
        .unwrap_or_else(|| m.auto_color(s.idx));
    let auto = LineProps {
        width: Some(AUTO_WIDTH),
        fill: Some(Fill::Solid(color)),
        dash: Some(preset_dash("sysDot")),
        cap: Some(Cap::Round),
        ..Default::default()
    };
    resolve_line(t.shape.line.as_ref(), Some(auto))
}

/// The observations of series `s`: `x` is the 1-based category number on
/// category axes and the x value on value axes.
fn observations(s: &SeriesModel, by_value: bool, n: usize) -> Vec<(f64, f64)> {
    let xs: Vec<Option<f64>> = if by_value {
        x_values(s)
    } else {
        (0..s.len().min(n)).map(|i| Some((i + 1) as f64)).collect()
    };
    xs.iter()
        .enumerate()
        .filter_map(|(i, x)| Some(((*x)?, s.value(i)?)))
        .filter(|(x, y)| x.is_finite() && y.is_finite())
        .collect()
}

/// The axis fraction of value `v` (not clamped to the axis range).
fn val_frac(p: &Plot<'_>, ai: usize, v: f64) -> f64 {
    match &p.axes[ai].map {
        Mapping::Val(s) => s.norm(v).clamp(-1e3, 1e3),
        Mapping::Cat { .. } => 0.5,
    }
}

/// Most trendlines drawn per chart (each fit is linear in the point count).
pub(crate) const MAX_PER_CHART: usize = 64;

/// Draws the trendlines of group `g` (category or x axis `ca`, value axis `va`)
/// and queues their labels; `budget` counts down the trendlines still allowed.
pub(crate) fn draw(
    cv: &mut Canvas<'_>,
    p: &Plot<'_>,
    g: &GroupModel,
    (ca, va): (usize, usize),
    budget: &mut usize,
    labels: &mut Vec<Pending>,
) {
    if !supported(g) {
        return;
    }
    let m = p.m;
    let by_value = matches!(p.axes[ca].map, Mapping::Val(_));
    let dated = p.axes[ca].date.is_some();
    let n = match p.axes[ca].map {
        Mapping::Cat { count, .. } => count,
        Mapping::Val(_) => usize::MAX,
    };
    let to_point = |x: f64, y: f64| {
        let along = if by_value {
            p.coord(ca, val_frac(p, ca, x))
        } else {
            p.coord(ca, p.cat_t(ca, x - 1.0))
        };
        let across = p.coord(va, val_frac(p, va, y));
        if p.axes[ca].vertical {
            Point::new(across, along)
        } else {
            Point::new(along, across)
        }
    };
    for s in &g.series {
        let obs = observations(s, by_value, n);
        let (Some(lo), Some(hi)) = (
            obs.iter().map(|o| o.0).reduce(f64::min),
            obs.iter().map(|o| o.0).reduce(f64::max),
        ) else {
            continue;
        };
        for t in &s.trendlines {
            if *budget == 0 {
                return;
            }
            *budget -= 1;
            let Some(line) = line(m, g, s, t) else {
                continue;
            };
            let mut pts: Vec<Point> = Vec::new();
            let mut stats = None;
            if let TrendKind::MovingAvg(period) = t.kind {
                for w in obs.windows(period.max(1)) {
                    let avg = w.iter().map(|o| o.1).sum::<f64>() / w.len() as f64;
                    if let Some(last) = w.last() {
                        pts.push(to_point(last.0, avg));
                    }
                }
            } else {
                let Some((f, r2)) = fit(t.kind, &obs, t.intercept) else {
                    continue;
                };
                let (x0, x1) = (lo - t.backward, hi + t.forward);
                // Date axes place categories unevenly: sample whole categories.
                let xs: Vec<f64> = if dated && !by_value {
                    let first = x0.ceil().max(1.0) as usize;
                    let last = (x1.floor().max(0.0) as usize).min(n);
                    (first..=last).map(|x| x as f64).collect()
                } else {
                    (0..=SAMPLES)
                        .map(|k| x0 + (x1 - x0) * k as f64 / SAMPLES as f64)
                        .collect()
                };
                pts.extend(xs.iter().filter_map(|&x| Some(to_point(x, f.eval(x)?))));
                stats = Some((f, r2, x1));
            }
            if pts.len() < 2 {
                continue;
            }
            let mut path = Path::new();
            path.move_to(pts[0]);
            for q in &pts[1..] {
                path.line_to(*q);
            }
            cv.clipped(p.inner, |cv| cv.stroke(&path, &line));
            if let Some((f, r2, x1)) = stats {
                let end = f.eval(x1).map(|y| to_point(x1, y));
                if let Some(label) = trend_label(cv, m, t, &f, r2, end, p.inner) {
                    labels.push(label);
                }
            }
        }
    }
}

/// The equation / R² label of a trendline ending at `end`.
fn trend_label(
    cv: &Canvas<'_>,
    m: &ChartModel,
    t: &TrendlineModel,
    f: &Fit,
    r2: f64,
    end: Option<Point>,
    inner: Rect,
) -> Option<Pending> {
    let l = t.label.clone().unwrap_or_default();
    let custom: Option<String> = l
        .custom
        .as_ref()
        .map(|pieces| pieces.iter().map(|(_, text)| text.as_str()).collect());
    // "General" keeps Excel's short coefficients.
    let fmt = l
        .num_fmt
        .as_ref()
        .filter(|f| !f.linked && !f.code.eq_ignore_ascii_case("general"))
        .map(|f| f.code.as_str());
    let text = match custom {
        Some(c) => c,
        None => {
            let mut lines = Vec::new();
            if t.show_eq {
                lines.push(equation(f, fmt, m.date1904));
            }
            if t.show_r2 {
                lines.push(format!("R² = {}", coef_text(r2, fmt, m.date1904)));
            }
            lines.join("\n")
        }
    };
    if text.trim().is_empty() {
        return None;
    }
    let style = apply(&l.text.props, &m.base_text(Role::Other));
    let block = cv.plain(&text, &style, f32::INFINITY, HAlign::Left);
    let rot = dlabel::rotation(&l);
    let (w, h) = block.rotated_size(rot);
    // Above the end of the line, kept inside the plot area.
    let end = end.unwrap_or(Point::new(inner.right(), inner.y));
    let x = (end.x - w / 2.0).clamp(
        inner.x + w / 2.0,
        (inner.right() - w / 2.0).max(inner.x + w / 2.0),
    );
    let y = (end.y - LABEL_GAP - h / 2.0).clamp(
        inner.y + h / 2.0,
        (inner.bottom() - h / 2.0).max(inner.y + h / 2.0),
    );
    Some(Pending {
        block,
        center: dlabel::offset(Point::new(x, y), &l, cv.chart),
        shape: l.shape.clone(),
        leader: None,
        rot,
    })
}
