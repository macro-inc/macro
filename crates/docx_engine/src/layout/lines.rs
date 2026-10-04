//! Line breaking and line boxes.
//!
//! Word breaks greedily: words are added until the next one would cross the
//! right indent, spaces hang past it, and a word longer than the line is
//! broken where it overflows. Tabs jump to the next stop (custom stops, the
//! hanging indent, then default stops after the last custom one); right,
//! center and decimal stops align the text that follows them. In justified
//! paragraphs, Word 2013 and later also keep a word that crosses the edge
//! slightly by shrinking the line's spaces.

use super::inline::{Inline, Kind};
use crate::model::props::{Align, LineSpacing, ParaProps, TabAlign, TabLeader};

/// How a line ended.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LineEnd {
    /// The text wrapped.
    Wrap,
    /// A manual line break.
    Break,
    /// A page break.
    PageBreak,
    /// A column break.
    ColumnBreak,
    /// The end of the paragraph.
    Paragraph,
}

/// One laid-out line.
#[derive(Clone, Debug, PartialEq)]
pub struct Line {
    /// First cluster.
    pub start: usize,
    /// One past the last cluster.
    pub end: usize,
    /// Top, relative to the paragraph's first line top (points).
    pub top: f32,
    /// Height (points).
    pub height: f32,
    /// Baseline below the line top (points).
    pub baseline: f32,
    /// Left edge of the line's text area (points from the text area left).
    pub left: f32,
    /// Right edge of the line's text area.
    pub right: f32,
    /// Width of the content without trailing spaces.
    pub width: f32,
    /// How the line ended.
    pub ends: LineEnd,
    /// The line ends at a soft hyphen that shows as a hyphen.
    pub hyphen: bool,
}

/// A paragraph's lines plus cluster positions.
#[derive(Clone, Debug, Default)]
pub struct Lines {
    /// The lines.
    pub lines: Vec<Line>,
    /// X of each cluster from the text area's left edge (points).
    pub x: Vec<f32>,
    /// Final advance of each cluster (after tabs and justification).
    pub adv: Vec<f32>,
    /// Leaders of tab clusters.
    pub leaders: Vec<(usize, TabLeader)>,
    /// Total height of the lines.
    pub height: f32,
}

/// What line layout needs to know about the paragraph's surroundings.
#[derive(Clone, Copy, Debug)]
pub struct LineCtx<'a> {
    /// Paragraph properties.
    pub props: &'a ParaProps,
    /// Width of the text area (column or cell content).
    pub width: f32,
    /// Default tab interval.
    pub default_tab: f32,
    /// Lines ending in manual breaks are not stretched when justified.
    pub no_expand_shift_return: bool,
    /// Document grid pitch when lines snap to it.
    pub grid: Option<f32>,
    /// Justified lines may shrink their spaces to fit more text (Word 2013
    /// and later).
    pub shrink_spaces: bool,
}

/// Space a wrapping float takes from a line: (left inset, right inset) for
/// a line spanning `top..bottom` (paragraph-relative points).
pub type Exclusion<'a> = &'a dyn Fn(f32, f32) -> (f32, f32);

const EPS: f32 = 0.01;

/// How much justified lines may shrink their spaces (fraction of their
/// natural width) to fit one more word, as Word 2013 and later do.
const MAX_SPACE_SHRINK: f32 = 0.21;
/// Word only shrinks spaces for a word that crosses the right edge by less
/// than this fraction of its own width.
const MAX_WORD_OVERFLOW: f32 = 0.35;

struct Stop {
    pos: f32,
    align: TabAlign,
    leader: TabLeader,
}

fn next_stop(x: f32, ctx: &LineCtx<'_>, first_line: bool) -> Stop {
    let p = ctx.props;
    let mut best: Option<Stop> = None;
    for s in &p.tabs {
        if s.align == TabAlign::Bar || s.pos <= x + EPS {
            continue;
        }
        if best.as_ref().is_none_or(|b| s.pos < b.pos) {
            best = Some(Stop {
                pos: s.pos,
                align: s.align,
                leader: s.leader,
            });
        }
    }
    // A hanging indent is an implicit stop on the first line.
    if first_line
        && p.ind_first < 0.0
        && p.ind_left > x + EPS
        && best.as_ref().is_none_or(|b| p.ind_left < b.pos)
    {
        best = Some(Stop {
            pos: p.ind_left,
            align: TabAlign::Left,
            leader: TabLeader::None,
        });
    }
    if let Some(b) = best {
        return b;
    }
    // Default stops, only after the last custom stop.
    let interval = ctx.default_tab.max(1.0);
    let last_custom = p
        .tabs
        .iter()
        .filter(|s| s.align != TabAlign::Bar)
        .map(|s| s.pos)
        .fold(f32::MIN, f32::max);
    let from = x.max(last_custom);
    let pos = ((from + EPS) / interval).floor() * interval + interval;
    Stop {
        pos,
        align: TabAlign::Left,
        leader: TabLeader::None,
    }
}

/// Width of the clusters after `from` up to the next tab or line end, and
/// of the part before a decimal separator.
fn segment_width(inline: &Inline, from: usize) -> (f32, f32) {
    let mut w = 0.0;
    let mut before_decimal: Option<f32> = None;
    for c in &inline.clusters[from..] {
        match c.kind {
            Kind::Tab | Kind::LineBreak | Kind::PageBreak | Kind::ColumnBreak | Kind::End => break,
            _ => {}
        }
        if before_decimal.is_none() && (c.ch == '.' || c.ch == ',') && c.kind == Kind::Text {
            before_decimal = Some(w);
        }
        w += c.advance;
    }
    (w, before_decimal.unwrap_or(w))
}

/// Width of the unbreakable run of clusters starting at `from`: up to and
/// including the next cluster that allows a break after it, stopping
/// before spaces, tabs and breaks.
fn word_width(inline: &Inline, adv: &[f32], from: usize) -> f32 {
    let mut w = 0.0;
    for (k, c) in inline.clusters.iter().enumerate().skip(from) {
        match c.kind {
            Kind::Space
            | Kind::Tab
            | Kind::LineBreak
            | Kind::PageBreak
            | Kind::ColumnBreak
            | Kind::End
            | Kind::SoftHyphen => break,
            _ => {}
        }
        w += adv[k];
        if c.brk == super::inline::Brk::After {
            break;
        }
    }
    w
}

fn is_content(kind: Kind) -> bool {
    matches!(
        kind,
        Kind::Text | Kind::Object(_) | Kind::Tab | Kind::Separator(_)
    )
}

/// Breaks a paragraph into lines.
pub fn break_lines(inline: &Inline, ctx: &LineCtx<'_>, exclude: Option<Exclusion<'_>>) -> Lines {
    let p = ctx.props;
    let n = inline.clusters.len();
    let shrink = if ctx.shrink_spaces && p.jc == Align::Justify {
        MAX_SPACE_SHRINK
    } else {
        0.0
    };
    let mut adv: Vec<f32> = inline.clusters.iter().map(|c| c.advance).collect();
    for (i, c) in inline.clusters.iter().enumerate() {
        if let Kind::Separator(continuation) = c.kind {
            adv[i] = if continuation {
                ctx.width
            } else {
                144.0f32.min(ctx.width)
            };
        }
    }
    let mut x_pos = vec![0.0f32; n];
    let mut leaders: Vec<(usize, TabLeader)> = Vec::new();
    let mut lines: Vec<Line> = Vec::new();
    let mut top = 0.0f32;
    let mut i = 0;
    while i < n {
        let first = lines.is_empty();
        let mut left = p.ind_left + if first { p.ind_first } else { 0.0 };
        let mut right = ctx.width - p.ind_right;
        if let Some(ex) = exclude {
            // Estimate the line's height with the paragraph mark's font.
            let (l, r) = ex(top, top + 12.0);
            left = left.max(l);
            right = right.min(ctx.width - r);
        }
        if right - left < 12.0 {
            right = left + 12.0;
        }
        let mut x = left;
        let mut j = i;
        let mut last_break: Option<usize> = None;
        let mut ends = LineEnd::Wrap;
        let mut has_content = false;
        let mut line_leaders: Vec<(usize, TabLeader)> = Vec::new();
        // Width of the spaces since the last tab (justification only
        // adjusts those).
        let mut spaces = 0.0f32;
        while j < n {
            let c = &inline.clusters[j];
            match c.kind {
                Kind::LineBreak | Kind::PageBreak | Kind::ColumnBreak | Kind::End => {
                    x_pos[j] = x;
                    ends = match c.kind {
                        Kind::LineBreak => LineEnd::Break,
                        Kind::PageBreak => LineEnd::PageBreak,
                        Kind::ColumnBreak => LineEnd::ColumnBreak,
                        _ => LineEnd::Paragraph,
                    };
                    j += 1;
                    break;
                }
                Kind::Tab => {
                    let stop = match c.ptab {
                        Some((pos, align)) => {
                            let edge_left = if pos < 0.0 { p.ind_left } else { 0.0 };
                            let edge_right = if pos < 0.0 {
                                ctx.width - p.ind_right
                            } else {
                                ctx.width
                            };
                            Stop {
                                pos: match align {
                                    TabAlign::Center => (edge_left + edge_right) / 2.0,
                                    TabAlign::Right => edge_right,
                                    _ => edge_left,
                                },
                                align,
                                leader: TabLeader::None,
                            }
                        }
                        None => next_stop(x, ctx, first),
                    };
                    let (seg, before_dec) = segment_width(inline, j + 1);
                    let target = match stop.align {
                        TabAlign::Right => stop.pos - seg,
                        TabAlign::Center => stop.pos - seg / 2.0,
                        TabAlign::Decimal => stop.pos - before_dec,
                        _ => stop.pos,
                    };
                    adv[j] = (target - x).max(0.0);
                    if stop.leader != TabLeader::None {
                        line_leaders.push((j, stop.leader));
                    }
                    x_pos[j] = x;
                    x += adv[j];
                    has_content = true;
                    last_break = Some(j);
                    spaces = 0.0;
                }
                Kind::Space => {
                    x_pos[j] = x;
                    x += adv[j];
                    spaces += adv[j];
                    last_break = Some(j);
                }
                Kind::Zero | Kind::Anchor(_) => x_pos[j] = x,
                Kind::SoftHyphen => {
                    x_pos[j] = x;
                    last_break = Some(j);
                }
                _ => {
                    // How far a word may cross the right edge when shrinking
                    // the spaces before it can pull it back in.
                    let allowance = if shrink > 0.0 && spaces > 0.0 && x + adv[j] > right + EPS {
                        let word = word_width(inline, &adv, last_break.map_or(i, |b| b + 1));
                        (spaces * shrink).min(word * MAX_WORD_OVERFLOW)
                    } else {
                        0.0
                    };
                    if x + adv[j] > right + allowance + EPS && has_content {
                        ends = LineEnd::Wrap;
                        if let Some(b) = last_break {
                            j = b + 1;
                        }
                        break;
                    }
                    x_pos[j] = x;
                    x += adv[j];
                    has_content |= is_content(c.kind);
                    if c.brk == super::inline::Brk::After {
                        last_break = Some(j);
                    }
                }
            }
            j += 1;
        }
        if j <= i {
            j = i + 1;
        }
        // Zero-width clusters right after a wrap stay on this line.
        while ends == LineEnd::Wrap
            && j < n
            && matches!(inline.clusters[j].kind, Kind::Zero | Kind::Anchor(_))
        {
            x_pos[j] = x_pos[j - 1] + adv[j - 1];
            j += 1;
        }
        let hyphen = ends == LineEnd::Wrap && inline.clusters[j - 1].kind == Kind::SoftHyphen;
        // Content width: up to the last cluster that is not a trailing space.
        let mut content_end = i;
        for k in i..j {
            if !matches!(
                inline.clusters[k].kind,
                Kind::Space
                    | Kind::Zero
                    | Kind::End
                    | Kind::LineBreak
                    | Kind::PageBreak
                    | Kind::ColumnBreak
                    | Kind::Anchor(_)
                    | Kind::SoftHyphen
            ) {
                content_end = k + 1;
            }
        }
        let content_right = if content_end > i {
            x_pos[content_end - 1] + adv[content_end - 1]
        } else {
            left
        };
        // Alignment and justification.
        let last_line = matches!(
            ends,
            LineEnd::Paragraph | LineEnd::PageBreak | LineEnd::ColumnBreak
        );
        let stretch = match p.jc {
            Align::Justify => !last_line && !(ends == LineEnd::Break && ctx.no_expand_shift_return),
            Align::Distribute => true,
            _ => false,
        };
        let last_tab = (i..content_end)
            .rev()
            .find(|&k| inline.clusters[k].kind == Kind::Tab)
            .map_or(i, |k| k + 1);
        let spaces: Vec<usize> = (last_tab..content_end)
            .filter(|&k| inline.clusters[k].kind == Kind::Space)
            .collect();
        // Text that only fits with shrunk spaces shrinks them, on any line
        // and never by more than they may shrink.
        let squeeze = shrink > 0.0 && right - content_right < -EPS && !spaces.is_empty();
        let slack = if squeeze {
            let room: f32 = spaces.iter().map(|&k| adv[k]).sum::<f32>() * shrink;
            (right - content_right).max(-room)
        } else {
            (right - content_right).max(0.0)
        };
        if (stretch && slack > EPS) || squeeze {
            if !spaces.is_empty() {
                let each = slack / spaces.len() as f32;
                let mut shift = 0.0;
                for k in last_tab..j {
                    x_pos[k] += shift;
                    if spaces.binary_search(&k).is_ok() {
                        adv[k] += each;
                        shift += each;
                    }
                }
            } else if p.jc == Align::Distribute && content_end > last_tab + 1 {
                let gaps = (content_end - last_tab - 1) as f32;
                let each = slack / gaps;
                for (g, k) in (last_tab..j).enumerate() {
                    x_pos[k] += each * (g.min(content_end - last_tab - 1)) as f32;
                }
            }
        } else if matches!(p.jc, Align::Center | Align::Right) && slack > EPS {
            let shift = if p.jc == Align::Center {
                slack / 2.0
            } else {
                slack
            };
            for k in i..j {
                x_pos[k] += shift;
            }
        }
        leaders.extend(line_leaders);
        let (height, baseline) = line_height(inline, i, j, ctx, &adv);
        lines.push(Line {
            start: i,
            end: j,
            top,
            height,
            baseline,
            left,
            right,
            width: content_right - left + if squeeze { slack } else { 0.0 },
            ends,
            hyphen,
        });
        top += height;
        i = j;
    }
    Lines {
        height: top,
        lines,
        x: x_pos,
        adv,
        leaders,
    }
}

/// Height and baseline of a line spanning clusters `start..end`.
fn line_height(
    inline: &Inline,
    start: usize,
    end: usize,
    ctx: &LineCtx<'_>,
    adv: &[f32],
) -> (f32, f32) {
    let mut ascent: f32 = 0.0;
    let mut descent: f32 = 0.0;
    let mut leading: f32 = 0.0;
    let mut seen = false;
    for c in &inline.clusters[start..end] {
        let style = &inline.runs[c.run as usize];
        match c.kind {
            Kind::Zero | Kind::Anchor(_) => continue,
            Kind::Object(o) => {
                let d = &inline.objects[o as usize];
                ascent = ascent.max(d.height + d.effect[1] + d.effect[3]);
                seen = true;
            }
            Kind::End => {
                // The paragraph mark counts toward the last line's height.
                if c.ch == '\u{0}' && seen {
                    continue;
                }
                ascent = ascent.max(style.ascent);
                descent = descent.max(style.descent);
                leading = leading.max(style.leading);
                seen = true;
            }
            _ => {
                ascent = ascent.max(style.ascent);
                descent = descent.max(style.descent);
                leading = leading.max(style.leading);
                seen = true;
            }
        }
    }
    let _ = adv;
    if !seen {
        // A line of hidden content: the paragraph mark's metrics.
        let style = &inline.runs[inline.clusters[end - 1].run as usize];
        ascent = style.ascent;
        descent = style.descent;
        leading = style.leading;
    }
    let natural = ascent + descent + leading;
    let (mut height, mut baseline) = match ctx.props.line {
        LineSpacing::Auto(m) if m >= 1.0 => {
            // Extra space of multiple line spacing goes below the text.
            (natural * m, leading + ascent)
        }
        LineSpacing::Auto(m) => {
            // Reduced spacing takes the space from above the text.
            let h = natural * m.max(0.05);
            (h, h - descent)
        }
        LineSpacing::Exact(v) => (v, v - descent * (v / natural.max(0.01)).min(1.0)),
        LineSpacing::AtLeast(v) => {
            let h = natural.max(v);
            (h, h - descent)
        }
    };
    if let Some(pitch) = ctx.grid
        && pitch > 1.0
        && matches!(ctx.props.line, LineSpacing::Auto(_))
    {
        let snapped = (height / pitch - 0.05).ceil().max(1.0) * pitch;
        baseline += (snapped - height) / 2.0;
        height = snapped;
    }
    (height, baseline)
}

#[cfg(test)]
mod test;
