//! Line breaking and line boxes.
//!
//! Word breaks greedily: words are added until the next one would cross the
//! right indent, spaces hang past it, and a word longer than the line is
//! broken where it overflows. Tabs jump to the next stop (custom stops, the
//! hanging indent, then default stops after the last custom one); right,
//! center and decimal stops align the text that follows them. In justified
//! paragraphs, Word 2013 and later also keep a word that crosses the edge
//! slightly by shrinking the line's spaces.

use super::bidi;
use super::inline::{Inline, Kind, device_metrics};
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
    /// A paragraph mark right after a page break stays on the break's line
    /// rather than going to the next page alone.
    pub mark_with_page_break: bool,
    /// Page x of the text area's left edge, when known. Word places lines
    /// in device units, which decides where the first tab of a line that
    /// starts on a default tab stop goes.
    pub origin: Option<f32>,
}

/// Space a wrapping float takes from a line: (left inset, right inset) for
/// a line spanning `top..bottom` (paragraph-relative points).
pub type Exclusion<'a> = &'a dyn Fn(f32, f32) -> (f32, f32);

const EPS: f32 = 0.01;

/// How much Word 2013 and later may shrink a space to squeeze one more word
/// into a justified line: a share of the space's glyph, without letter
/// spacing.
const SPACE_SHRINK: f32 = 0.25;
/// The share of a space's whole advance that text Word measures with a
/// device font (scaled or kerned runs) may lose: it squeezes less, as the
/// line ends of the UN's New York documents show.
const DEVICE_SPACE_SHRINK: f32 = 0.21;
/// Word only shrinks spaces for a word that crosses the right edge by less
/// than this fraction of its own width.
const MAX_WORD_OVERFLOW: f32 = 0.35;

struct Stop {
    pos: f32,
    align: TabAlign,
    leader: TabLeader,
    /// Set in the paragraph's tabs (not a default stop).
    custom: bool,
}

/// A length in twips in Word's device units (1/600 inch), rounded half to
/// even.
fn device_units(twips: i64) -> i64 {
    let n = twips * 5;
    let (q, r) = (n.div_euclid(12), n.rem_euclid(12));
    match (2 * r).cmp(&12) {
        std::cmp::Ordering::Greater => q + 1,
        std::cmp::Ordering::Equal => q + (q & 1),
        std::cmp::Ordering::Less => q,
    }
}

/// Whether a line starting `x` points into a text area whose left edge is
/// at page x `origin` really starts before that point in Word: Word starts
/// it at the rounded edge plus the rounded indent, and places tab stops at
/// the rounded sum (A4 pages with 2 cm margins and indents start a device
/// unit early).
fn starts_early(origin: f32, x: f32) -> bool {
    let twips = |v: f32| (v * 20.0).round() as i64;
    let (origin, x) = (twips(origin), twips(x));
    device_units(origin) + device_units(x) < device_units(origin + x)
}

/// The stop a tab at `x` goes to; `line_start` when nothing comes before it
/// on its line.
fn next_stop(x: f32, ctx: &LineCtx<'_>, first_line: bool, line_start: bool) -> Stop {
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
                custom: true,
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
            custom: false,
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
    let mut pos = ((from + EPS) / interval).floor() * interval + interval;
    // A line starting on a default stop that Word starts just before it:
    // its first tab goes to that stop.
    let on_stop = x > EPS && ((x / interval).round() * interval - x).abs() < EPS;
    if line_start
        && on_stop
        && last_custom < x - EPS
        && ctx.origin.is_some_and(|o| starts_early(o, x))
    {
        pos = x;
    }
    Stop {
        pos,
        align: TabAlign::Left,
        leader: TabLeader::None,
        custom: false,
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

/// How much Word may shrink each cluster when it squeezes a justified line
/// (points; only spaces shrink).
fn squeeze_room(inline: &Inline) -> Vec<f32> {
    inline
        .clusters
        .iter()
        .map(|c| {
            if c.kind != Kind::Space {
                return 0.0;
            }
            let Some(style) = inline.runs.get(usize::from(c.run)) else {
                return c.advance * SPACE_SHRINK;
            };
            let props = &style.props;
            if device_metrics(props, c.size) {
                c.advance * DEVICE_SPACE_SHRINK
            } else {
                (c.advance - props.spacing).max(0.0) * SPACE_SHRINK
            }
        })
        .collect()
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
    break_lines_from(inline, ctx, exclude, 0)
}

/// Breaks the rest of a paragraph, from cluster `start` on, into lines (a
/// paragraph going on in a column of another width). The lines' tops
/// count from the first of them.
pub fn break_lines_from(
    inline: &Inline,
    ctx: &LineCtx<'_>,
    exclude: Option<Exclusion<'_>>,
    start: usize,
) -> Lines {
    let p = ctx.props;
    let n = inline.clusters.len();
    let shrink = ctx.shrink_spaces && p.jc == Align::Justify;
    let mut adv: Vec<f32> = inline.clusters.iter().map(|c| c.advance).collect();
    let squeezable = squeeze_room(inline);
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
    let mut i = start.min(n);
    while i < n {
        let first = lines.is_empty() && start == 0;
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
        // How much the spaces since the last tab may shrink (justification
        // only adjusts those).
        let mut room = 0.0f32;
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
                    if ends == LineEnd::PageBreak
                        && ctx.mark_with_page_break
                        && inline.clusters[j..]
                            .iter()
                            .all(|c| matches!(c.kind, Kind::Zero | Kind::End))
                    {
                        // Nothing but the paragraph mark follows the break:
                        // the mark stays with it.
                        x_pos[j..n].fill(x);
                        j = n;
                    }
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
                                custom: false,
                            }
                        }
                        None => next_stop(x, ctx, first, !has_content),
                    };
                    // A tab to a stop of its own past the right edge goes
                    // to the next line, as a word that does not fit would.
                    if stop.custom
                        && stop.align == TabAlign::Left
                        && stop.pos > right + EPS
                        && has_content
                    {
                        ends = LineEnd::Wrap;
                        break;
                    }
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
                    room = 0.0;
                }
                Kind::Space => {
                    x_pos[j] = x;
                    x += adv[j];
                    room += squeezable[j];
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
                    let allowance = if shrink && room > 0.0 && x + adv[j] > right + EPS {
                        let word = word_width(inline, &adv, last_break.map_or(i, |b| b + 1));
                        room.min(word * MAX_WORD_OVERFLOW)
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
            Align::Justify => !(last_line || ends == LineEnd::Break && ctx.no_expand_shift_return),
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
        let squeeze = shrink && right - content_right < -EPS && !spaces.is_empty();
        let slack = if squeeze {
            let room: f32 = spaces.iter().map(|&k| squeezable[k]).sum();
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
            for x in &mut x_pos[i..j] {
                *x += shift;
            }
        }
        if !inline.levels.is_empty() {
            visual_order(inline, i, j, ctx, &mut x_pos, &adv);
        }
        leaders.extend(line_leaders);
        let (mut height, mut baseline) = line_height(inline, i, j, ctx, &adv);
        if matches!(ends, LineEnd::PageBreak | LineEnd::ColumnBreak)
            && !has_content
            && (j < n || ends == LineEnd::PageBreak)
        {
            // A paragraph that starts with a break starts after it, and a
            // page that ends with a bare break has nothing below it: the
            // break takes no room where it is.
            height = 0.0;
            baseline = 0.0;
        }
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

/// Puts a line of bidirectional text (clusters `start..end`, laid out
/// left to right in logical order) in visual order: a right-to-left
/// paragraph's line mirrored to start at the right, and runs against the
/// paragraph's direction reversed in place.
fn visual_order(
    inline: &Inline,
    start: usize,
    end: usize,
    ctx: &LineCtx<'_>,
    x: &mut [f32],
    adv: &[f32],
) {
    let base = u8::from(ctx.props.bidi);
    let mut levels = inline.levels[start..end].to_vec();
    // The line's trailing whitespace is at the paragraph's level.
    for k in (start..end).rev() {
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
            break;
        }
        levels[k - start] = base;
    }
    bidi::reorder(
        &mut x[start..end],
        &adv[start..end],
        &levels,
        base,
        (0.0, ctx.width),
    );
}

/// Height and baseline of a line spanning clusters `start..end`.
fn line_height(
    inline: &Inline,
    start: usize,
    end: usize,
    ctx: &LineCtx<'_>,
    adv: &[f32],
) -> (f32, f32) {
    // Each font's external leading sits above its ascent: the line's top
    // part is the largest of them, its bottom part the largest descent.
    let mut above: f32 = 0.0;
    let mut object: f32 = 0.0;
    let mut descent: f32 = 0.0;
    let mut leading: f32 = 0.0;
    let mut seen = false;
    let mut text = false;
    for c in &inline.clusters[start..end] {
        let style = &inline.runs[c.run as usize];
        match c.kind {
            Kind::Zero | Kind::Anchor(_) => continue,
            Kind::Object(o) => {
                let d = &inline.objects[o as usize];
                object = object.max(d.height + d.effect[1] + d.effect[3]);
                seen = true;
            }
            Kind::End => {
                // The paragraph mark sizes a line without text (empty, or
                // only pictures, which sit on its baseline); text lines take
                // their height from the text alone.
                if text || (c.ch == '\u{0}' && seen) {
                    continue;
                }
                above = above.max(style.leading + style.ascent);
                descent = descent.max(style.descent);
                leading = leading.max(style.leading);
                seen = true;
            }
            _ => {
                above = above.max(style.leading + style.ascent);
                descent = descent.max(style.descent);
                leading = leading.max(style.leading);
                seen = true;
                text = true;
            }
        }
    }
    let _ = adv;
    if !seen {
        // A line of hidden content: the paragraph mark's metrics.
        let style = &inline.runs[inline.clusters[end - 1].run as usize];
        above = style.leading + style.ascent;
        descent = style.descent;
        leading = style.leading;
    }
    // Pictures stand on the baseline below the text's leading.
    let top = above.max(object + leading);
    let natural = top + descent;
    let (mut height, mut baseline) = match ctx.props.line {
        LineSpacing::Auto(m) if m >= 1.0 => {
            // Extra space of multiple line spacing goes below the text.
            (natural * m, top)
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
