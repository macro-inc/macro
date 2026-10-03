//! Tick computation for a plot: automatic value scales, category label
//! rotation/wrapping/thinning, date-axis labels, and axis titles.

use super::axis::{Fixed, Scale, auto_scale};
use super::canvas::{Block, Canvas, LINE_HEIGHT};
use super::model::TickLabels;
use super::numfmt;
use super::plot::{LABEL_GAP, Mapping, Plot, TICK_LEN, TickLabel, V_DENSITY, title_paras};
use super::style::Role;
use crate::render::label::HAlign;

/// Widest axis title running across its axis, as a fraction of the chart.
const ACROSS_TITLE: f32 = 0.2;

/// Whether every `k`-th label clears its shown neighbours horizontally: a
/// label wider than its slot (an unbreakable word) may use spare room beside
/// shorter neighbours. A lone label must fit its slot.
fn pairs_fit(blocks: &[Block], k: usize, slot: f32, pad: f32) -> bool {
    let k = k.max(1);
    let room = slot * k as f32;
    if let [only] = blocks {
        return only.width + pad <= room;
    }
    let shown: Vec<f32> = blocks.iter().step_by(k).map(|b| b.width).collect();
    shown.windows(2).all(|w| (w[0] + w[1]) / 2.0 + pad <= room)
}

impl Plot<'_> {
    /// Automatic scales for value axes, given the current plot size.
    pub(crate) fn compute_scales(&mut self, cv: &Canvas<'_>) {
        for ai in 0..self.axes.len() {
            if !self.axes[ai].is_value {
                continue;
            }
            let len = self.len(ai).max(1.0);
            let a = &self.axes[ai];
            let fixed = Fixed {
                min: a.model.min,
                max: a.model.max,
                major: a.model.major_unit,
                minor: a.model.minor_unit,
                log_base: a.model.log_base,
            };
            let size = a.style.size;
            let data = if a.percent {
                a.data.map(|(lo, hi)| (lo.max(-1.0), hi.min(1.0)))
            } else {
                a.data
            };
            let scale = if a.vertical {
                let max_n = (len / (size * V_DENSITY)).floor().max(1.0) as usize;
                auto_scale(data, fixed, a.percent, max_n, &|_| true)
            } else {
                let fmt = a.fmt.clone();
                let style = a.style.clone();
                let unit = a.model.disp_unit.unwrap_or(1.0);
                let date1904 = self.m.date1904;
                let fits = move |s: &Scale| {
                    let ticks = s.ticks();
                    if ticks.len() < 2 {
                        return true;
                    }
                    let spacing = len / (ticks.len() - 1) as f32;
                    let widths: Vec<f32> = ticks
                        .iter()
                        .map(|v| cv.measure(&numfmt::format(v / unit, &fmt, date1904), &style))
                        .collect();
                    widths
                        .windows(2)
                        .all(|w| (w[0] + w[1]) / 2.0 + style.size * 0.6 <= spacing)
                };
                auto_scale(data, fixed, a.percent, 10, &fits)
            };
            self.axes[ai].map = Mapping::Val(scale);
        }
    }

    /// Tick labels (with category label rotation, wrapping, and thinning).
    pub(crate) fn compute_labels(&mut self, cv: &Canvas<'_>) {
        let date1904 = self.m.date1904;
        for ai in 0..self.axes.len() {
            let len = self.len(ai).max(1.0);
            if self.date_labels(cv, ai, len) {
                continue;
            }
            let a = &self.axes[ai];
            let mut labels = Vec::new();
            let mut rot = a.model.text.rot.unwrap_or(0.0);
            if a.model.deleted || a.model.tick_labels == TickLabels::None {
                self.axes[ai].labels = labels;
                continue;
            }
            match &a.map {
                Mapping::Val(s) => {
                    let unit = a.model.disp_unit.unwrap_or(1.0);
                    for v in s.ticks() {
                        let text = numfmt::format(v / unit, &a.fmt, date1904);
                        labels.push(TickLabel {
                            t: s.norm(v),
                            block: cv.plain(&text, &a.style, f32::INFINITY, HAlign::Center),
                        });
                    }
                }
                Mapping::Cat { count, between } => {
                    let n = *count;
                    if n == 0 {
                        self.axes[ai].labels = labels;
                        continue;
                    }
                    let slot = if *between || n <= 1 {
                        len / n as f32
                    } else {
                        len / (n - 1) as f32
                    };
                    // Labels thinned explicitly get the room of the skipped ones.
                    let slot = slot * a.model.label_skip.unwrap_or(1) as f32;
                    let lh = a.style.size * LINE_HEIGHT;
                    let pad = a.style.size * 0.3;
                    let explicit_rot = a.model.text.rot;
                    let blocks: Vec<Block>;
                    let mut skip;
                    if a.vertical {
                        // Room beside the plot (manual layouts), at least 40% of the chart.
                        let room = (self.inner.x - cv.chart.x)
                            .max(cv.chart.right() - self.inner.right())
                            - TICK_LEN
                            - LABEL_GAP;
                        let max_w = room.max(cv.chart.w * 0.4).max(a.style.size * 3.0);
                        blocks = a
                            .cat_text
                            .iter()
                            .map(|t| cv.plain(t, &a.style, max_w, HAlign::Center))
                            .collect();
                        let h = blocks
                            .iter()
                            .map(|b| b.rotated_size(rot).1)
                            .fold(lh, f32::max);
                        skip = (h / slot).ceil().max(1.0) as usize;
                    } else {
                        let single: Vec<Block> = a
                            .cat_text
                            .iter()
                            .map(|t| cv.plain(t, &a.style, f32::INFINITY, HAlign::Center))
                            .collect();
                        if let Some(r) = explicit_rot.filter(|r| r.abs() > 0.5) {
                            rot = r;
                            blocks = single;
                        } else if single.iter().all(|b| b.width + pad <= slot) {
                            rot = 0.0;
                            blocks = single;
                        } else {
                            let wrapped: Vec<Block> = a
                                .cat_text
                                .iter()
                                .map(|t| {
                                    cv.plain(t, &a.style, (slot - pad).max(1.0), HAlign::Center)
                                })
                                .collect();
                            let fits = wrapped.iter().all(|b| b.lines.len() <= 3)
                                && pairs_fit(&wrapped, 1, slot, pad);
                            // An explicit horizontal angle still wraps, never turns.
                            if fits || explicit_rot.is_some() {
                                rot = 0.0;
                                blocks = wrapped;
                            } else {
                                rot = -45.0;
                                blocks = single;
                            }
                        }
                        skip = if rot.abs() < 0.5 {
                            (1..blocks.len().max(1))
                                .find(|&k| pairs_fit(&blocks, k, slot, pad))
                                .unwrap_or(blocks.len().max(1))
                        } else {
                            let foot =
                                lh / (f64::from(rot).to_radians().sin().abs() as f32).max(0.1);
                            (foot / slot).ceil().max(1.0) as usize
                        };
                    }
                    if let Some(k) = a.model.label_skip {
                        skip = k;
                    }
                    for (i, b) in blocks.into_iter().enumerate().step_by(skip.max(1)) {
                        labels.push(TickLabel {
                            t: self.cat_t(ai, i as f64),
                            block: b,
                        });
                    }
                }
            }
            self.axes[ai].rot = rot;
            self.axes[ai].labels = labels;
            self.outer_rows(cv, ai, len);
        }
        // Axis titles.
        for ai in 0..self.axes.len() {
            let a = &self.axes[ai];
            let title = match (&a.model.title, a.model.deleted) {
                (Some(t), false) => {
                    let base = self.m.base_text(Role::AxisTitle);
                    let paras = title_paras(t, &base, "Axis Title");
                    let rot = t
                        .rich
                        .as_ref()
                        .and_then(|r| r.rot)
                        .or(t.tx_pr.rot)
                        .unwrap_or(if a.vertical { -90.0 } else { 0.0 });
                    // Text running along the axis wraps at its length; text
                    // across it at a fraction of the chart.
                    let along = (rot.abs() > 45.0) == a.vertical;
                    let max_w = match (along, a.vertical) {
                        (true, true) => self.inner.h,
                        (true, false) => self.inner.w,
                        (false, true) => cv.chart.w * ACROSS_TITLE,
                        (false, false) => cv.chart.h * ACROSS_TITLE,
                    }
                    .max(20.0);
                    let block = cv.layout(&paras, max_w);
                    Some((block, rot))
                }
                _ => None,
            };
            let unit = match (&a.model.disp_label, a.model.deleted) {
                (Some((t, name)), false) if a.model.disp_unit.is_some() => {
                    let paras = title_paras(t, &self.m.base_text(Role::AxisTitle), name);
                    let block = cv.layout(&paras, f32::INFINITY);
                    let rot = t
                        .rich
                        .as_ref()
                        .and_then(|r| r.rot)
                        .or(t.tx_pr.rot)
                        .unwrap_or(if a.vertical { -90.0 } else { 0.0 });
                    (!block.is_empty()).then_some((block, rot))
                }
                _ => None,
            };
            self.axes[ai].title = title;
            self.axes[ai].unit = unit;
        }
    }

    /// Groups of the outer levels of multi-level categories.
    fn outer_rows(&mut self, cv: &Canvas<'_>, ai: usize, len: f32) {
        let a = &self.axes[ai];
        let n = match a.map {
            Mapping::Cat { count, .. } => count,
            Mapping::Val(_) => 0,
        };
        if a.model.deleted || a.model.tick_labels == TickLabels::None || n == 0 {
            self.axes[ai].outer = Vec::new();
            return;
        }
        let half = self.slot_t(ai) / 2.0;
        let mut rows = Vec::new();
        for level in &a.outer_text {
            let starts: Vec<usize> = (0..n)
                .filter(|&i| {
                    level
                        .get(i)
                        .and_then(|v| v.as_deref())
                        .is_some_and(|v| !v.is_empty())
                })
                .collect();
            let mut row = Vec::new();
            for (k, &start) in starts.iter().enumerate() {
                let end = starts.get(k + 1).map_or(n - 1, |next| next - 1);
                let (t0, t1) = (
                    self.cat_t(ai, start as f64) - half,
                    self.cat_t(ai, end as f64) + half,
                );
                let span = (len * (t1 - t0).abs() as f32).max(a.style.size * 2.0);
                let text = level[start].as_deref().unwrap_or("");
                let max_w = if a.vertical { f32::INFINITY } else { span };
                row.push((t0, t1, cv.plain(text, &a.style, max_w, HAlign::Center)));
            }
            rows.push(row);
        }
        self.axes[ai].outer = rows;
    }

    /// Ticks and labels of a date axis; `false` when `ai` is not one.
    fn date_labels(&mut self, cv: &Canvas<'_>, ai: usize, len: f32) -> bool {
        let a = &self.axes[ai];
        let Some(d) = &a.date else { return false };
        let date1904 = self.m.date1904;
        let pad = a.style.size * 0.6;
        let widest = cv
            .measure(&numfmt::format(d.end, &a.fmt, date1904), &a.style)
            .max(cv.measure(&numfmt::format(d.start, &a.fmt, date1904), &a.style));
        let max_labels = if a.vertical {
            len / (a.style.size * LINE_HEIGHT)
        } else {
            len / (widest + pad)
        };
        let (step, unit) = d.major(
            &a.model,
            a.model.major_time,
            max_labels.floor().max(1.0) as usize,
        );
        let dates = d.label_dates(step, unit);
        let half = if d.between { d.slot() / 2.0 } else { 0.0 };
        let ticks: Vec<f64> = dates
            .iter()
            .map(|&s| d.date_t(s) - half)
            .filter(|t| (-1e-9..=1.0 + 1e-9).contains(t))
            .collect();
        let mut labels = Vec::new();
        let mut rot = a.model.text.rot.unwrap_or(0.0);
        if !a.model.deleted && a.model.tick_labels != TickLabels::None {
            let spacing = if dates.len() > 1 {
                len * (d.date_t(dates[1]) - d.date_t(dates[0])) as f32
            } else {
                len
            };
            if a.model.text.rot.is_none() && !a.vertical && widest + pad > spacing {
                rot = -45.0;
            }
            for s in dates {
                let t = d.date_t(s);
                if (-1e-9..=1.0 + 1e-9).contains(&t) {
                    let text = numfmt::format(s, &a.fmt, date1904);
                    labels.push(TickLabel {
                        t,
                        block: cv.plain(&text, &a.style, f32::INFINITY, HAlign::Center),
                    });
                }
            }
        }
        let ax = &mut self.axes[ai];
        ax.date_ticks = ticks;
        ax.labels = labels;
        ax.rot = rot;
        true
    }
}
