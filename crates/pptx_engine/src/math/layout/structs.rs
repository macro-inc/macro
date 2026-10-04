//! Layout of each OMML structure.

use super::super::symbols::is_integral;
use super::super::tree::{Borders, FracKind, LimLoc, List, Node, Run};
use super::{Env, Level, MathBox, MathItem, ROW_GAP, ROW_MIN, St};
use crate::model::text::RunProps;
use crate::path::{Point, Rect};

/// Lays out one structure.
pub(super) fn layout(env: &Env, node: &Node, st: &St) -> MathBox {
    match node {
        Node::Frac {
            kind,
            num,
            den,
            props,
        } => frac(env, *kind, num, den, props.as_deref(), st),
        Node::Scripts { base, sub, sup } => {
            let b = env.hlist(base, st);
            let single = is_single_char(base);
            scripts(env, b, single, sub.as_ref(), sup.as_ref(), st)
        }
        Node::PreScripts { base, sub, sup } => prescripts(env, base, sub, sup, st),
        Node::Radical {
            degree,
            body,
            props,
        } => radical(env, degree.as_ref(), body, props.as_deref(), st),
        Node::Nary {
            op,
            limits,
            grow,
            sub,
            sup,
            body,
            props,
        } => nary(
            env,
            *op,
            *limits,
            *grow,
            sub,
            sup,
            body,
            props.as_deref(),
            st,
        ),
        Node::Delim {
            open,
            close,
            sep,
            grow,
            items,
            props,
        } => delim(env, *open, *close, *sep, *grow, items, props.as_deref(), st),
        Node::Limit { upper, base, limit } => limit_box(env, *upper, base, limit, st),
        Node::Accent { chr, base, props } => accent(env, *chr, base, props.as_deref(), st),
        Node::Bar { top, base, props } => bar(env, *top, base, props.as_deref(), st),
        Node::GroupChr {
            chr,
            top,
            base,
            props,
        } => group_chr(env, *chr, *top, base, props.as_deref(), st),
        Node::BorderBox {
            borders,
            base,
            props,
        } => border_box(env, borders, base, props.as_deref(), st),
        Node::EqArray(rows) => eq_array(env, rows, st, false),
        Node::Matrix(rows) => matrix(env, rows, st),
        Node::Phantom {
            show,
            zero_width,
            zero_ascent,
            zero_descent,
            base,
        } => {
            let mut b = env.hlist(base, st);
            if !show {
                b.items.clear();
            }
            if *zero_width {
                b.width = 0.0;
            }
            if *zero_ascent {
                b.ascent = 0.0;
            }
            if *zero_descent {
                b.descent = 0.0;
            }
            b
        }
        other => env.hlist(std::slice::from_ref(other), st),
    }
}

/// Whether a list is one character (scripts then sit at fixed shifts
/// rather than relative to the base's height).
fn is_single_char(list: &[Node]) -> bool {
    matches!(list, [Node::Run(r)] if !r.normal && r.text.chars().count() == 1)
}

fn frac(
    env: &Env,
    kind: FracKind,
    num: &List,
    den: &List,
    props: Option<&RunProps>,
    st: &St,
) -> MathBox {
    let own = st.with(props, env.font_scale);
    let em = env.em(&own);
    let c = &env.c;
    match kind {
        FracKind::Linear => {
            let mut atoms = vec![env.ord(env.arg(num, st))];
            let slash = Node::Run(Run::new("/"));
            let mut tmp = Vec::new();
            env.node(&slash, &own, &mut tmp);
            atoms.extend(tmp);
            atoms.push(env.ord(env.arg(den, st)));
            env.join(atoms, st)
        }
        FracKind::Skewed => {
            let n = env.arg(num, &st.sup());
            let d = env.arg(den, &st.sub());
            let mut tmp = Vec::new();
            env.node(&Node::Run(Run::new("/")), &own, &mut tmp);
            let slash = tmp.pop().map(|a| a.bx).unwrap_or_default();
            let mut out = MathBox::default();
            let raise = (c.axis_height + 0.12) * em;
            let n_w = n.width;
            out.place(n, 0.0, -raise);
            let sx = n_w - 0.08 * em;
            let s_w = slash.width;
            out.place(slash, sx, 0.0);
            out.place(d, sx + s_w - 0.08 * em, 0.0);
            out
        }
        FracKind::Bar | FracKind::NoBar => {
            let n = env.arg(num, &st.num());
            let d = env.arg(den, &st.den());
            let display = st.display();
            let axis = c.axis_height * em;
            let (up, down) = if kind == FracKind::Bar {
                let t = c.fraction_rule_thickness * em;
                let (shift_up, shift_down, gap_n, gap_d) = if display {
                    (
                        c.fraction_numerator_display_style_shift_up,
                        c.fraction_denominator_display_style_shift_down,
                        c.fraction_num_display_style_gap_min,
                        c.fraction_denom_display_style_gap_min,
                    )
                } else {
                    (
                        c.fraction_numerator_shift_up,
                        c.fraction_denominator_shift_down,
                        c.fraction_numerator_gap_min,
                        c.fraction_denominator_gap_min,
                    )
                };
                let up = (shift_up * em).max(axis + t / 2.0 + gap_n * em + n.descent);
                let down = (shift_down * em).max(d.ascent + gap_d * em - axis + t / 2.0);
                (up, down)
            } else {
                let (mut up, mut down, gap) = if display {
                    (
                        c.stack_top_display_style_shift_up * em,
                        c.stack_bottom_display_style_shift_down * em,
                        c.stack_display_style_gap_min * em,
                    )
                } else {
                    (
                        c.stack_top_shift_up * em,
                        c.stack_bottom_shift_down * em,
                        c.stack_gap_min * em,
                    )
                };
                let actual = (up - n.descent) - (d.ascent - down);
                if actual < gap {
                    up += (gap - actual) / 2.0;
                    down += (gap - actual) / 2.0;
                }
                (up, down)
            };
            // The bar overhangs the wider part a little, with a little room outside.
            let margin = 0.06 * em;
            let overhang = 0.06 * em;
            let inner = n.width.max(d.width);
            let total = inner + 2.0 * (margin + overhang);
            let mut out = MathBox::space(total, 0.0, 0.0);
            let (nw, dw) = (n.width, d.width);
            out.place(n, (total - nw) / 2.0, -up);
            out.place(d, (total - dw) / 2.0, down);
            if kind == FracKind::Bar {
                let t = c.fraction_rule_thickness * em;
                out.rule(
                    Rect::from_xywh(margin, -(axis + t / 2.0), total - 2.0 * margin, t),
                    &own.fill,
                );
            }
            out.width = total;
            out
        }
    }
}

/// Whether a superscript is only primes (set at full size, unraised: the
/// prime glyphs already sit high).
fn primes_only(list: &List) -> bool {
    !list.is_empty()
        && list.iter().all(|n| {
            matches!(n, Node::Run(r) if r.text.chars().all(|c| matches!(c, '′' | '″' | '‴' | '⁗')))
        })
}

/// The superscript rise `u` and subscript drop `v` for scripts on a base
/// (TeX's rule 18 with the font's constants).
fn script_shifts(
    env: &Env,
    b: &MathBox,
    single_char: bool,
    sb: Option<&MathBox>,
    sp: Option<&MathBox>,
    st: &St,
) -> (f32, f32) {
    let em = env.em(st);
    let c = &env.c;
    let mut u = if single_char {
        0.0
    } else {
        b.ascent - c.superscript_baseline_drop_max * em
    };
    let mut v = if single_char {
        0.0
    } else {
        b.descent + c.subscript_baseline_drop_min * em
    };
    let sup_shift = if st.cramped {
        c.superscript_shift_up_cramped
    } else {
        c.superscript_shift_up
    } * em;
    match (sb, sp) {
        (None, Some(p)) => {
            u = u
                .max(sup_shift)
                .max(p.descent + c.superscript_bottom_min * em);
        }
        (Some(s), None) => {
            v = v
                .max(c.subscript_shift_down * em)
                .max(s.ascent - c.subscript_top_max * em);
        }
        (Some(s), Some(p)) => {
            u = u
                .max(sup_shift)
                .max(p.descent + c.superscript_bottom_min * em);
            v = v.max(c.subscript_shift_down * em);
            let gap = (u - p.descent) - (s.ascent - v);
            let min_gap = c.sub_superscript_gap_min * em;
            if gap < min_gap {
                v += min_gap - gap;
                let lift = c.superscript_bottom_max_with_subscript * em - (u - p.descent);
                if lift > 0.0 {
                    u += lift;
                    v -= lift;
                }
            }
        }
        (None, None) => {}
    }
    (u, v)
}

/// The superscript style: smaller, cramped when the base is.
fn sup_style(st: &St) -> St {
    St {
        cramped: st.cramped,
        ..st.sup()
    }
}

/// Places scripts after `b` (a base already laid out).
fn scripts(
    env: &Env,
    mut b: MathBox,
    single_char: bool,
    sub: Option<&List>,
    sup: Option<&List>,
    st: &St,
) -> MathBox {
    if sub.is_none()
        && let Some(p) = sup
        && primes_only(p)
    {
        let primes = env.hlist(p, st);
        let x = b.width;
        b.place(primes, x, 0.0);
        return b;
    }
    let sp = sup.map(|l| env.arg(l, &sup_style(st)));
    let sb = sub.map(|l| env.arg(l, &st.sub()));
    let (u, v) = script_shifts(env, &b, single_char, sb.as_ref(), sp.as_ref(), st);
    // The base's width includes its italic correction: superscripts go
    // after it, subscripts tuck under it.
    let x0 = b.width;
    let italic = b.italic;
    let mut right = x0;
    if let Some(p) = sp {
        right = right.max(x0 + p.width);
        b.place(p, x0, -u);
    }
    if let Some(s) = sb {
        right = right.max(x0 - italic + s.width);
        b.place(s, x0 - italic, v);
    }
    b.width = right + env.c.space_after_script * env.em(st);
    b.italic = 0.0;
    b
}

fn prescripts(env: &Env, base: &List, sub: &List, sup: &List, st: &St) -> MathBox {
    let em = env.em(st);
    let b = env.hlist(base, st);
    let sp = env.arg(sup, &sup_style(st));
    let sb = env.arg(sub, &st.sub());
    let (u, v) = script_shifts(env, &b, is_single_char(base), Some(&sb), Some(&sp), st);
    let w = sp.width.max(sb.width);
    let mut out = MathBox::default();
    let (pw, bw) = (sp.width, sb.width);
    out.place(sp, w - pw, -u);
    out.place(sb, w - bw, v);
    out.place(b, w + 0.05 * em, 0.0);
    out
}

fn radical(
    env: &Env,
    degree: Option<&List>,
    body: &List,
    props: Option<&RunProps>,
    st: &St,
) -> MathBox {
    let own = st.with(props, env.font_scale);
    let em = env.em(&own);
    let c = &env.c;
    let body = env.arg(body, &st.cramp());
    let t = c.radical_rule_thickness * em;
    let mut gap = if st.display() {
        c.radical_display_style_vertical_gap
    } else {
        c.radical_vertical_gap
    } * em;
    let target = body.ascent + body.descent + gap + t;
    let sign = env.stretch('√', target, true, em, &own.fill);
    let sign_h = sign.bx.ascent + sign.bx.descent;
    if sign_h > target {
        gap += (sign_h - target) / 2.0;
    }
    let top = body.ascent + gap + t;
    let sign_box = sign.bx.clone().lower(sign.bx.ascent - top);
    let sign_bottom = sign_box.descent;
    let mut out = MathBox::default();
    // The index sits over the sign's left arm.
    let mut x = 0.0;
    if let Some(deg) = degree.filter(|d| !d.is_empty()) {
        let deg_st = St {
            level: Level::ScriptScript,
            cramped: false,
            ..st.clone()
        };
        let d = env.hlist(deg, &deg_st);
        let raise = c.radical_degree_bottom_raise * sign_h;
        let y = sign_bottom - raise - d.descent;
        let kern_before = c.radical_kern_before_degree * em;
        let dw = d.width;
        out.place(d, kern_before, y);
        x = (kern_before + dw + c.radical_kern_after_degree * em).max(0.0);
    }
    let sw = sign_box.width;
    out.place(sign_box, x, 0.0);
    let bx0 = x + sw;
    let bw = body.width;
    out.place(body, bx0, 0.0);
    out.rule(
        Rect::from_xywh(bx0 - 0.01 * em, -top, bw + 0.06 * em, t),
        &own.fill,
    );
    out.ascent = out.ascent.max(top + c.radical_extra_ascender * em);
    out.width = bx0 + bw + 0.06 * em;
    out
}

#[expect(
    clippy::too_many_arguments,
    reason = "the fields of an n-ary node, unpacked"
)]
fn nary(
    env: &Env,
    op: char,
    limits: LimLoc,
    grow: bool,
    sub: &Option<List>,
    sup: &Option<List>,
    body: &List,
    props: Option<&RunProps>,
    st: &St,
) -> MathBox {
    let own = st.with(props, env.font_scale);
    let em = env.em(&own);
    let c = &env.c;
    let display = st.display();
    let mut target = if display {
        c.display_operator_min_height * em
    } else {
        0.0
    };
    if grow {
        let b = env.hlist(body, st);
        target = target.max((b.ascent + b.descent) * 1.1);
    }
    let stretched = env.stretch(op, target, true, em, &own.fill);
    let italic = stretched.italic;
    let axis = c.axis_height * em;
    let center = (stretched.bx.ascent - stretched.bx.descent) / 2.0;
    let mut opbox = stretched.bx.lower(center - axis);
    opbox.italic = italic;
    let under_over = display
        && match limits {
            LimLoc::UnderOver => true,
            LimLoc::SubSup => false,
            LimLoc::Auto => !is_integral(op),
        };
    if !under_over {
        // Limits as scripts; integrals tuck the lower one under their tail.
        let sp = sup.as_ref().map(|l| env.arg(l, &sup_style(st)));
        let sb = sub.as_ref().map(|l| env.arg(l, &st.sub()));
        let (u, v) = script_shifts(env, &opbox, false, sb.as_ref(), sp.as_ref(), st);
        let x0 = opbox.width;
        let mut out = opbox;
        let mut right = x0;
        if let Some(p) = sp {
            right = right.max(x0 + p.width);
            out.place(p, x0, -u);
        }
        if let Some(s) = sb {
            right = right.max(x0 - italic + s.width);
            out.place(s, x0 - italic, v);
        }
        out.width = right;
        out.italic = 0.0;
        return out;
    }
    let sp = sup.as_ref().map(|l| env.arg(l, &st.sup()));
    let sb = sub.as_ref().map(|l| env.arg(l, &st.sub()));
    let w = opbox
        .width
        .max(sp.as_ref().map_or(0.0, |b| b.width))
        .max(sb.as_ref().map_or(0.0, |b| b.width));
    let mut out = MathBox::default();
    let (op_top, op_bottom) = (opbox.ascent, opbox.descent);
    let ow = opbox.width;
    out.place(opbox, (w - ow) / 2.0, 0.0);
    if let Some(p) = sp {
        let rise =
            (c.upper_limit_gap_min * em + p.descent).max(c.upper_limit_baseline_rise_min * em);
        let pw = p.width;
        out.place(p, (w - pw) / 2.0 + italic / 2.0, -(op_top + rise));
    }
    if let Some(s) = sb {
        let drop =
            (c.lower_limit_gap_min * em + s.ascent).max(c.lower_limit_baseline_drop_min * em);
        let sw = s.width;
        out.place(s, (w - sw) / 2.0 - italic / 2.0, op_bottom + drop);
    }
    out.width = w;
    out
}

#[expect(
    clippy::too_many_arguments,
    reason = "the fields of a delimiter node, unpacked"
)]
fn delim(
    env: &Env,
    open: Option<char>,
    close: Option<char>,
    sep: char,
    grow: bool,
    items: &[List],
    props: Option<&RunProps>,
    st: &St,
) -> MathBox {
    let own = st.with(props, env.font_scale);
    let em = env.em(&own);
    let c = &env.c;
    let boxes: Vec<MathBox> = if items.is_empty() {
        vec![env.arg(&Vec::new(), st)]
    } else {
        items.iter().map(|l| env.arg(l, st)).collect()
    };
    let asc = boxes.iter().map(|b| b.ascent).fold(0.0f32, f32::max);
    let desc = boxes.iter().map(|b| b.descent).fold(0.0f32, f32::max);
    let axis = c.axis_height * em;
    let delta = (asc - axis).max(desc + axis);
    let target = (2.0 * delta * 0.901).max(2.0 * delta - 0.5 * em);
    let make = |ch: Option<char>| -> MathBox {
        let Some(ch) = ch else {
            return MathBox::space(0.12 * em, 0.0, 0.0);
        };
        // Text-size brackets come from the text font when they are big enough.
        if let Some((choice, glyph, _)) = env.char_glyph(ch, super::super::tree::Style::Plain, None)
        {
            let plain = env.glyph_box(choice, glyph, em, &own.fill);
            let small = 2.0 * delta < c.delimited_sub_formula_min_height * em;
            if !grow || small || plain.ascent + plain.descent >= target {
                return plain;
            }
        }
        let s = env.stretch(ch, target, true, em, &own.fill);
        let center = (s.bx.ascent - s.bx.descent) / 2.0;
        s.bx.lower(center - axis)
    };
    // Cases: the rows of a brace-only array are left-aligned.
    let boxes = match items {
        [item] if open == Some('{') && close.is_none() => match item.as_slice() {
            [Node::EqArray(rows)] => vec![eq_array(env, rows, st, true)],
            _ => boxes,
        },
        _ => boxes,
    };
    let mut atoms = vec![env.ord(make(open))];
    for (i, b) in boxes.into_iter().enumerate() {
        if i > 0 {
            atoms.push(env.ord(make(Some(sep))));
        }
        atoms.push(env.ord(b));
    }
    atoms.push(env.ord(make(close)));
    env.join(atoms, st)
}

fn limit_box(env: &Env, upper: bool, base: &List, limit: &List, st: &St) -> MathBox {
    let em = env.em(st);
    let c = &env.c;
    let b = env.arg(base, st);
    let l = env.arg(limit, &if upper { st.sup() } else { st.sub() });
    let w = b.width.max(l.width);
    let mut out = MathBox::default();
    let (b_asc, b_desc, bw, lw) = (b.ascent, b.descent, b.width, l.width);
    out.place(b, (w - bw) / 2.0, 0.0);
    if upper {
        let rise =
            (c.upper_limit_gap_min * em + l.descent).max(c.upper_limit_baseline_rise_min * em);
        out.place(l, (w - lw) / 2.0, -(b_asc + rise));
    } else {
        let drop =
            (c.lower_limit_gap_min * em + l.ascent).max(c.lower_limit_baseline_drop_min * em);
        out.place(l, (w - lw) / 2.0, b_desc + drop);
    }
    out.width = w;
    out
}

/// Accents that stretch to cover their base (arrows); others take the
/// largest size that does not overhang it.
fn covers_base(chr: char) -> bool {
    matches!(
        chr,
        '\u{20D6}' | '\u{20D7}' | '\u{20E1}' | '\u{20D0}' | '\u{20D1}'
    )
}

fn accent(env: &Env, chr: char, base: &List, props: Option<&RunProps>, st: &St) -> MathBox {
    let own = st.with(props, env.font_scale);
    let em = env.em(&own);
    let c = &env.c;
    let b = env.arg(base, &st.cramp());
    // Where the base wants its accent: the math font's attachment point,
    // else the middle of the ink, nudged right for italic letters.
    let base_glyph = single_glyph(&b);
    let attach = base_glyph
        .and_then(|(face, glyph, size)| {
            (Some(face) == env.math.face)
                .then(|| env.math.top_accent(glyph).map(|a| a * size))
                .flatten()
        })
        .or_else(|| {
            base_glyph.map(|(face, glyph, size)| {
                let ink = env.ink(face, glyph);
                (ink.left + ink.right) / 2.0 * size + b.italic / 2.0
            })
        })
        .unwrap_or(b.width / 2.0);
    let (glyph, accent_box) = accent_glyph(env, chr, b.width, em, &own.fill);
    let acc_attach = match glyph {
        Some(g) => {
            let face = env.math.face;
            let ink = face.map(|f| env.ink(f, g)).unwrap_or_default();
            let a = env
                .math
                .top_accent(g)
                .filter(|_| ink.advance > 0.0)
                .unwrap_or((ink.left + ink.right) / 2.0);
            a * em
        }
        None => accent_box.width / 2.0,
    };
    let lift = (b.ascent - c.accent_base_height * em).max(0.0);
    let mut out = MathBox::default();
    let bw = b.width;
    out.place(b, 0.0, 0.0);
    out.place(accent_box, attach - acc_attach, -lift);
    out.width = bw;
    out
}

/// The accent glyph for a base of `width` points: the glyph and its box.
fn accent_glyph(
    env: &Env,
    chr: char,
    width: f32,
    em: f32,
    fill: &crate::model::fill::Fill,
) -> (Option<u16>, MathBox) {
    let Some((choice, base)) = env.math_glyph(chr) else {
        return (None, MathBox::default());
    };
    if covers_base(chr) {
        let s = env.stretch(chr, width, false, em, fill);
        return (s.glyph, s.bx);
    }
    let construction = if Some(choice.face) == env.math.face {
        env.math.construction(base, false)
    } else {
        Default::default()
    };
    let mut pick = base;
    for v in &construction.variants {
        if v.advance * em > width * 1.05 {
            break;
        }
        pick = v.glyph;
    }
    (Some(pick), env.glyph_box(choice, pick, em, fill))
}

/// The only glyph of a box, with its size.
fn single_glyph(b: &MathBox) -> Option<(crate::font::FaceId, u16, f32)> {
    match b.items.as_slice() {
        [MathItem::Glyph(g)] => Some((g.face, g.glyph, g.size)),
        _ => None,
    }
}

fn bar(env: &Env, top: bool, base: &List, props: Option<&RunProps>, st: &St) -> MathBox {
    let own = st.with(props, env.font_scale);
    let em = env.em(&own);
    let c = &env.c;
    let b = env.arg(base, &if top { st.cramp() } else { st.clone() });
    let mut out = MathBox::default();
    let (asc, desc, w) = (b.ascent, b.descent, b.width);
    out.place(b, 0.0, 0.0);
    if top {
        let t = c.overbar_rule_thickness * em;
        let y = -(asc + c.overbar_vertical_gap * em + t);
        out.rule(Rect::from_xywh(0.0, y, w, t), &own.fill);
        out.ascent = out.ascent.max(-y + c.overbar_extra_ascender * em);
    } else {
        let t = c.underbar_rule_thickness * em;
        let y = desc + c.underbar_vertical_gap * em;
        out.rule(Rect::from_xywh(0.0, y, w, t), &own.fill);
        out.descent = out.descent.max(y + t + c.overbar_extra_ascender * em);
    }
    out.width = w;
    out
}

fn group_chr(
    env: &Env,
    chr: char,
    top: bool,
    base: &List,
    props: Option<&RunProps>,
    st: &St,
) -> MathBox {
    let own = st.with(props, env.font_scale);
    let em = env.em(&own);
    let b = env.arg(base, st);
    let s = env.stretch(chr, b.width, false, em, &own.fill);
    // The glyph's real ink (it may sit wholly above or below the baseline).
    let (ink_top, ink_bottom) = (s.top, s.bottom);
    let gap = 0.1 * em;
    let w = b.width.max(s.bx.width);
    let mut out = MathBox::default();
    let (asc, desc, bw, gw) = (b.ascent, b.descent, b.width, s.bx.width);
    out.place(b, (w - bw) / 2.0, 0.0);
    // Heights are measured upward from the baseline.
    let dy = if top {
        // Ink bottom at the base's top plus the gap.
        ink_bottom - (asc + gap)
    } else {
        // Ink top below the base's bottom by the gap.
        ink_top + desc + gap
    };
    let mut g = s.bx;
    g.ascent = ink_top;
    g.descent = -ink_bottom;
    out.place(g, (w - gw) / 2.0, dy);
    out.width = w;
    out
}

fn border_box(
    env: &Env,
    borders: &Borders,
    base: &List,
    props: Option<&RunProps>,
    st: &St,
) -> MathBox {
    let own = st.with(props, env.font_scale);
    let em = env.em(&own);
    let b = env.arg(base, st);
    let framed =
        !(borders.hide_top && borders.hide_bottom && borders.hide_left && borders.hide_right);
    let pad = if framed { 0.12 * em } else { 0.04 * em };
    let t = (0.05 * em).max(0.4);
    let (asc, desc, bw) = (b.ascent, b.descent, b.width);
    let (l, r) = (0.0, bw + 2.0 * pad);
    let (top, bottom) = (-(asc + pad), desc + pad);
    let mut out = MathBox::default();
    out.place(b, pad, 0.0);
    let fill = &own.fill;
    if !borders.hide_top {
        out.rule(Rect::from_ltrb(l, top, r, top + t), fill);
    }
    if !borders.hide_bottom {
        out.rule(Rect::from_ltrb(l, bottom - t, r, bottom), fill);
    }
    if !borders.hide_left {
        out.rule(Rect::from_ltrb(l, top, l + t, bottom), fill);
    }
    if !borders.hide_right {
        out.rule(Rect::from_ltrb(r - t, top, r, bottom), fill);
    }
    let axis = env.c.axis_height * em;
    let mut line = |from: Point, to: Point| {
        out.items.push(MathItem::Line {
            from,
            to,
            width: t,
            fill: fill.clone(),
        });
    };
    if borders.strike_h {
        line(Point::new(l, -axis), Point::new(r, -axis));
    }
    if borders.strike_v {
        let x = (l + r) / 2.0;
        line(Point::new(x, top), Point::new(x, bottom));
    }
    if borders.strike_bltr {
        line(Point::new(l, bottom), Point::new(r, top));
    }
    if borders.strike_tlbr {
        line(Point::new(l, top), Point::new(r, bottom));
    }
    out.ascent = out.ascent.max(-top);
    out.descent = out.descent.max(bottom);
    out.width = r;
    out
}

/// Splits a row at its `&` alignment marks.
fn split_at_marks(row: &List) -> Vec<List> {
    let mut cells: Vec<List> = vec![Vec::new()];
    for node in row {
        match node {
            Node::Run(r) if !r.normal && r.text.contains('&') => {
                for (i, part) in r.text.split('&').enumerate() {
                    if i > 0 {
                        cells.push(Vec::new());
                    }
                    if !part.is_empty() {
                        let mut piece = r.clone();
                        piece.text = part.to_owned();
                        if let Some(cell) = cells.last_mut() {
                            cell.push(Node::Run(piece));
                        }
                    }
                }
            }
            other => {
                if let Some(cell) = cells.last_mut() {
                    cell.push(other.clone());
                }
            }
        }
    }
    cells
}

/// How the columns of a grid line up.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Columns {
    /// Equation arrays: right- and left-aligned in turn, meeting at the marks.
    Aligned,
    /// Cases: every column left-aligned.
    Left,
    /// Matrices: centered, with space between columns.
    Centered,
}

/// Stacks rows of cells.
fn grid(env: &Env, rows: Vec<Vec<MathBox>>, st: &St, columns: Columns) -> MathBox {
    let em = env.em(st);
    let ncols = rows.iter().map(Vec::len).max().unwrap_or(0);
    let mut widths = vec![0.0f32; ncols];
    for row in &rows {
        for (i, cell) in row.iter().enumerate() {
            widths[i] = widths[i].max(cell.width);
        }
    }
    let col_gap = if columns == Columns::Centered {
        0.8 * em
    } else {
        0.0
    };
    let total_w: f32 = widths.iter().sum::<f32>() + col_gap * ncols.saturating_sub(1) as f32;
    let mut out = MathBox::default();
    let mut y = 0.0f32;
    let mut prev_descent = 0.0f32;
    for (r, row) in rows.into_iter().enumerate() {
        let asc = row.iter().map(|b| b.ascent).fold(0.0f32, f32::max);
        let desc = row.iter().map(|b| b.descent).fold(0.0f32, f32::max);
        if r > 0 {
            y += (prev_descent + ROW_GAP * em + asc).max(ROW_MIN * em);
        }
        // An array row without marks is centered.
        let unaligned = columns == Columns::Aligned && row.len() == 1;
        let row_w: f32 = row.iter().map(|b| b.width).sum();
        let mut x = 0.0f32;
        for (i, cell) in row.into_iter().enumerate() {
            let cw = cell.width;
            let cx = match columns {
                _ if unaligned => (total_w - row_w) / 2.0,
                Columns::Centered => x + (widths[i] - cw) / 2.0,
                Columns::Left => x,
                Columns::Aligned if i % 2 == 0 => x + widths[i] - cw,
                Columns::Aligned => x,
            };
            out.place(cell, cx, y);
            x += widths[i] + col_gap;
        }
        prev_descent = desc;
    }
    // Center the block on the math axis.
    let axis = env.c.axis_height * em;
    let center = (out.descent - out.ascent) / 2.0;
    let shift = -axis - center;
    let mut out = out.lower(shift);
    out.width = total_w;
    out
}

fn eq_array(env: &Env, rows: &[List], st: &St, left: bool) -> MathBox {
    let cells: Vec<Vec<MathBox>> = rows
        .iter()
        .map(|row| {
            split_at_marks(row)
                .iter()
                .map(|cell| env.hlist(cell, st))
                .collect()
        })
        .collect();
    grid(
        env,
        cells,
        st,
        if left {
            Columns::Left
        } else {
            Columns::Aligned
        },
    )
}

fn matrix(env: &Env, rows: &[Vec<List>], st: &St) -> MathBox {
    let cells: Vec<Vec<MathBox>> = rows
        .iter()
        .map(|row| row.iter().map(|cell| env.arg(cell, st)).collect())
        .collect();
    grid(env, cells, st, Columns::Centered)
}
