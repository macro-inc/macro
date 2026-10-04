//! Text editing on the DOM: insert, delete, split, replace, and format.
//!
//! Positions count Unicode scalar values; `a:br` counts as one character and
//! fields count as their displayed text, matching the layout's caret stops.

use super::links::{LinkRef, set_run_link};
use super::ops::{BodyPatch, BulletSpec, ParaPatch, RunPatch, TextPos};
use super::xmlutil::{
    BODY_PR_ORDER, P_PR_ORDER, R_PR_ORDER, color_element, replace_fill, solid_fill,
};
use crate::error::{Error, Result};
use crate::units::pt_to_emu;
use crate::xml::{NodeId, Ns, XmlDoc};

/// The run-like children of a paragraph with their text lengths.
fn items(doc: &XmlDoc, p: NodeId) -> Vec<(NodeId, usize)> {
    doc.children(p)
        .filter_map(|c| match doc.local(c) {
            "r" | "fld" => Some((c, run_text(doc, c).chars().count())),
            "br" => Some((c, 1)),
            _ => None,
        })
        .collect()
}

fn run_text(doc: &XmlDoc, r: NodeId) -> String {
    doc.child(r, Ns::A, "t")
        .map(|t| doc.text(t))
        .unwrap_or_default()
}

fn set_run_text(doc: &mut XmlDoc, r: NodeId, text: &str) {
    let t = doc.ensure_child(r, Ns::A, "t", &["rPr", "pPr", "t"]);
    doc.set_text(t, text);
}

/// Paragraph elements of a text body.
pub fn paragraphs(doc: &XmlDoc, body: NodeId) -> Vec<NodeId> {
    doc.children_named(body, Ns::A, "p").collect()
}

/// Length of a paragraph in characters.
pub fn para_len(doc: &XmlDoc, p: NodeId) -> usize {
    items(doc, p).iter().map(|(_, l)| l).sum()
}

/// Plain text of a paragraph (`a:br` = `\u{b}`).
pub fn para_text(doc: &XmlDoc, p: NodeId) -> String {
    items(doc, p)
        .iter()
        .map(|&(n, _)| {
            if doc.local(n) == "br" {
                "\u{b}".to_owned()
            } else {
                run_text(doc, n)
            }
        })
        .collect()
}

/// Ensures a run boundary at `offset` and returns the index (among all child
/// nodes of `p`) before which content at `offset` starts.
fn split_at(doc: &mut XmlDoc, p: NodeId, offset: usize) -> usize {
    let mut pos = 0;
    for (node, len) in items(doc, p) {
        if offset == pos {
            return doc.index_in_parent(node).unwrap_or(0);
        }
        if offset < pos + len {
            // Split inside a text run (fields and breaks are atomic: split before them).
            if doc.local(node) != "r" {
                return doc.index_in_parent(node).unwrap_or(0);
            }
            let text: Vec<char> = run_text(doc, node).chars().collect();
            let k = offset - pos;
            let right = doc.deep_clone(node);
            set_run_text(doc, node, &text[..k].iter().collect::<String>());
            set_run_text(doc, right, &text[k..].iter().collect::<String>());
            doc.insert_after(node, right);
            return doc.index_in_parent(right).unwrap_or(0);
        }
        pos += len;
    }
    // At (or past) the end: before endParaRPr if present.
    doc.child(p, Ns::A, "endParaRPr")
        .and_then(|e| doc.index_in_parent(e))
        .unwrap_or_else(|| doc.child_nodes(p).len())
}

/// The `a:rPr` to use for text typed at `offset` (formatting of the preceding run).
fn rpr_template(doc: &XmlDoc, p: NodeId, offset: usize) -> Option<NodeId> {
    let mut pos = 0;
    let mut last: Option<NodeId> = None;
    for (node, len) in items(doc, p) {
        if doc.local(node) == "r" && (pos < offset || last.is_none()) {
            last = doc.child(node, Ns::A, "rPr").or(last);
        }
        pos += len;
        if pos >= offset && last.is_some() {
            break;
        }
    }
    last
}

/// Creates a run with text, copying `template` (an `rPr` or `endParaRPr`).
fn new_run(doc: &mut XmlDoc, text: &str, template: Option<NodeId>) -> NodeId {
    let r = doc.create_element(Ns::A, "r");
    let rpr = match template {
        Some(t) => {
            let copy = doc.deep_clone(t);
            rename(doc, copy, "rPr");
            copy
        }
        None => {
            let e = doc.create_element(Ns::A, "rPr");
            doc.set_attr(e, "lang", "en-US");
            e
        }
    };
    doc.set_attr(rpr, "dirty", "0");
    doc.append_child(r, rpr);
    let t = doc.create_element(Ns::A, "t");
    doc.append_child(r, t);
    doc.set_text(t, text);
    r
}

fn rename(doc: &mut XmlDoc, node: NodeId, local: &str) {
    doc.rename(node, local);
}

fn paragraph_at(doc: &XmlDoc, body: NodeId, i: usize) -> Result<NodeId> {
    paragraphs(doc, body)
        .get(i)
        .copied()
        .ok_or_else(|| Error::InvalidEdit(format!("paragraph {i} does not exist")))
}

/// Inserts text (which may contain `\n` paragraph breaks and `\u{b}` line breaks).
pub fn insert_text(doc: &mut XmlDoc, body: NodeId, at: TextPos, text: &str) -> Result<TextPos> {
    let mut pos = at;
    let mut first = true;
    for piece in text.split('\n') {
        if !first {
            pos = split_paragraph(doc, body, pos)?;
        }
        first = false;
        let p = paragraph_at(doc, body, pos.paragraph)?;
        let len = para_len(doc, p);
        if pos.offset > len {
            return Err(Error::InvalidEdit(format!(
                "offset {} is past the end of paragraph {}",
                pos.offset, pos.paragraph
            )));
        }
        for (k, segment) in piece.split('\u{b}').enumerate() {
            if k > 0 {
                let idx = split_at(doc, p, pos.offset);
                let br = doc.create_element(Ns::A, "br");
                if let Some(t) = rpr_template(doc, p, pos.offset) {
                    let copy = doc.deep_clone(t);
                    doc.append_child(br, copy);
                }
                doc.insert_child(p, idx, br);
                pos.offset += 1;
            }
            if segment.is_empty() {
                continue;
            }
            // Extend the run that ends at the caret when possible.
            let mut cursor = 0;
            let mut target: Option<(NodeId, usize)> = None;
            for (node, l) in items(doc, p) {
                if doc.local(node) == "r" && pos.offset > cursor && pos.offset <= cursor + l {
                    target = Some((node, pos.offset - cursor));
                    break;
                }
                if doc.local(node) == "r" && pos.offset == 0 && cursor == 0 {
                    target = Some((node, 0));
                    break;
                }
                cursor += l;
            }
            match target {
                Some((run, k)) => {
                    let mut chars: Vec<char> = run_text(doc, run).chars().collect();
                    let k = k.min(chars.len());
                    chars.splice(k..k, segment.chars());
                    set_run_text(doc, run, &chars.into_iter().collect::<String>());
                }
                None => {
                    let template = rpr_template(doc, p, pos.offset)
                        .or_else(|| doc.child(p, Ns::A, "endParaRPr"));
                    let run = new_run(doc, segment, template);
                    let idx = split_at(doc, p, pos.offset);
                    doc.insert_child(p, idx, run);
                }
            }
            pos.offset += segment.chars().count();
        }
    }
    Ok(pos)
}

/// Splits a paragraph at a position (Enter key). Returns the start of the new paragraph.
pub fn split_paragraph(doc: &mut XmlDoc, body: NodeId, at: TextPos) -> Result<TextPos> {
    let p = paragraph_at(doc, body, at.paragraph)?;
    let idx = split_at(doc, p, at.offset);
    let new_p = doc.create_element(Ns::A, "p");
    if let Some(ppr) = doc.child(p, Ns::A, "pPr") {
        let copy = doc.deep_clone(ppr);
        doc.append_child(new_p, copy);
    }
    let moving: Vec<NodeId> = doc.child_nodes(p)[idx..]
        .iter()
        .copied()
        .filter(|&c| matches!(doc.local(c), "r" | "br" | "fld"))
        .collect();
    let template = rpr_template(doc, p, at.offset);
    for m in moving {
        doc.append_child(new_p, m);
    }
    // Both halves keep an end-of-paragraph mark with the caret's formatting.
    match doc.child(p, Ns::A, "endParaRPr") {
        Some(end) => {
            let copy = doc.deep_clone(end);
            doc.append_child(new_p, copy);
        }
        None => {
            if let Some(t) = template {
                let copy = doc.deep_clone(t);
                rename(doc, copy, "endParaRPr");
                doc.remove_attr(copy, "dirty");
                doc.append_child(new_p, copy);
            }
        }
    }
    doc.insert_after(p, new_p);
    Ok(TextPos {
        paragraph: at.paragraph + 1,
        offset: 0,
    })
}

/// Deletes the text between `start` and `end` (exclusive), joining paragraphs.
pub fn delete_text(doc: &mut XmlDoc, body: NodeId, start: TextPos, end: TextPos) -> Result<()> {
    if (end.paragraph, end.offset) <= (start.paragraph, start.offset) {
        return Ok(());
    }
    let ps = paragraphs(doc, body);
    let sp = *ps
        .get(start.paragraph)
        .ok_or_else(|| Error::InvalidEdit("start paragraph out of range".into()))?;
    let ep = *ps
        .get(end.paragraph)
        .ok_or_else(|| Error::InvalidEdit("end paragraph out of range".into()))?;
    if start.offset > para_len(doc, sp) || end.offset > para_len(doc, ep) {
        return Err(Error::InvalidEdit("offset out of range".into()));
    }
    let keep_format = rpr_template(doc, sp, start.offset + 1);
    if sp == ep {
        remove_range(doc, sp, start.offset, end.offset);
    } else {
        let len = para_len(doc, sp);
        remove_range(doc, sp, start.offset, len);
        remove_range(doc, ep, 0, end.offset);
        // Move the rest of the end paragraph into the start paragraph.
        let rest: Vec<NodeId> = doc
            .children(ep)
            .filter(|&c| matches!(doc.local(c), "r" | "br" | "fld"))
            .collect();
        let anchor = doc.child(sp, Ns::A, "endParaRPr");
        for n in rest {
            match anchor {
                Some(a) => doc.insert_before(a, n),
                None => doc.append_child(sp, n),
            }
        }
        for &p in &ps[start.paragraph + 1..=end.paragraph] {
            doc.detach(p);
        }
    }
    // An emptied paragraph remembers the formatting of the deleted text.
    if para_len(doc, sp) == 0
        && let Some(t) = keep_format
        && doc.child(sp, Ns::A, "endParaRPr").is_none()
    {
        let copy = doc.deep_clone(t);
        rename(doc, copy, "endParaRPr");
        doc.remove_attr(copy, "dirty");
        doc.append_child(sp, copy);
    }
    Ok(())
}

fn remove_range(doc: &mut XmlDoc, p: NodeId, from: usize, to: usize) {
    if to <= from {
        return;
    }
    split_at(doc, p, to);
    split_at(doc, p, from);
    let mut pos = 0;
    for (node, len) in items(doc, p) {
        if pos >= from && pos + len <= to && len > 0 {
            doc.detach(node);
        }
        pos += len;
    }
    // Drop runs left empty by splitting.
    for (node, len) in items(doc, p) {
        if len == 0 && doc.local(node) == "r" {
            doc.detach(node);
        }
    }
}

/// Replaces all text of a body, keeping each paragraph's formatting where possible.
pub fn set_text(doc: &mut XmlDoc, body: NodeId, text: &str) -> Result<()> {
    let old = paragraphs(doc, body);
    let templates: Vec<(Option<NodeId>, Option<NodeId>)> = old
        .iter()
        .map(|&p| {
            let ppr = doc.child(p, Ns::A, "pPr");
            let rpr = items(doc, p)
                .iter()
                .find(|(n, _)| doc.local(*n) == "r")
                .and_then(|(n, _)| doc.child(*n, Ns::A, "rPr"))
                .or_else(|| doc.child(p, Ns::A, "endParaRPr"));
            (ppr, rpr)
        })
        .collect();
    let anchor = old.first().copied();
    let mut new_ps = Vec::new();
    for (i, line) in text.split('\n').enumerate() {
        let (ppr, rpr) = templates
            .get(i)
            .or(templates.last())
            .copied()
            .unwrap_or((None, None));
        let p = doc.create_element(Ns::A, "p");
        if let Some(ppr) = ppr {
            let c = doc.deep_clone(ppr);
            doc.append_child(p, c);
        }
        for (k, seg) in line.split('\u{b}').enumerate() {
            if k > 0 {
                let br = doc.create_element(Ns::A, "br");
                if let Some(t) = rpr {
                    let c = doc.deep_clone(t);
                    rename(doc, c, "rPr");
                    doc.append_child(br, c);
                }
                doc.append_child(p, br);
            }
            if !seg.is_empty() {
                let r = new_run(doc, seg, rpr);
                doc.append_child(p, r);
            }
        }
        if let Some(t) = rpr {
            let c = doc.deep_clone(t);
            rename(doc, c, "endParaRPr");
            doc.remove_attr(c, "dirty");
            doc.append_child(p, c);
        }
        new_ps.push(p);
    }
    for (i, p) in new_ps.into_iter().enumerate() {
        match (i, anchor) {
            (0, Some(a)) => doc.insert_before(a, p),
            _ => doc.append_child(body, p),
        }
    }
    for p in old {
        doc.detach(p);
    }
    // Keep paragraphs after lstStyle (append_child may have placed them at the end, which is right).
    Ok(())
}

fn ensure_rpr(doc: &mut XmlDoc, run: NodeId) -> NodeId {
    if let Some(r) = doc.child(run, Ns::A, "rPr") {
        return r;
    }
    let r = doc.create_element(Ns::A, "rPr");
    doc.set_attr(r, "lang", "en-US");
    doc.insert_child(run, 0, r);
    r
}

/// Applies a character-format patch to an `rPr`/`endParaRPr`/`defRPr` element.
pub fn patch_rpr(
    doc: &mut XmlDoc,
    rpr: NodeId,
    patch: &RunPatch,
    link: Option<&LinkRef>,
) -> Result<()> {
    let flag = |v: bool| if v { "1" } else { "0" };
    if let Some(b) = patch.bold {
        doc.set_attr(rpr, "b", flag(b));
    }
    if let Some(i) = patch.italic {
        doc.set_attr(rpr, "i", flag(i));
    }
    if let Some(u) = patch.underline {
        doc.set_attr(rpr, "u", if u { "sng" } else { "none" });
    }
    if let Some(s) = patch.strike {
        doc.set_attr(rpr, "strike", if s { "sngStrike" } else { "noStrike" });
    }
    if let Some(sz) = patch.size {
        if !(1.0..=4000.0).contains(&sz) {
            return Err(Error::InvalidEdit(format!(
                "font size {sz} is out of range"
            )));
        }
        doc.set_attr(rpr, "sz", &((sz * 100.0).round() as i64).to_string());
    }
    if let Some(b) = patch.baseline {
        if b == 0.0 {
            doc.remove_attr(rpr, "baseline");
        } else {
            doc.set_attr(rpr, "baseline", &((b * 1000.0).round() as i64).to_string());
        }
    }
    if let Some(spacing) = patch.spacing {
        if !(-100.0..=400.0).contains(&spacing) {
            return Err(Error::InvalidEdit(format!(
                "character spacing {spacing} pt is out of range"
            )));
        }
        if spacing == 0.0 {
            doc.remove_attr(rpr, "spc");
        } else {
            doc.set_attr(rpr, "spc", &((spacing * 100.0).round() as i64).to_string());
        }
    }
    if let Some(c) = &patch.color {
        let fill = solid_fill(doc, c, None)?;
        replace_fill(doc, rpr, fill, R_PR_ORDER);
    }
    if let Some(h) = &patch.highlight {
        doc.remove_children_named(rpr, Ns::A, "highlight");
        if !h.is_empty() {
            let el = doc.create_element(Ns::A, "highlight");
            let c = color_element(doc, h, None)?;
            doc.append_child(el, c);
            doc.insert_in_order(rpr, el, R_PR_ORDER);
        }
    }
    if let Some(f) = &patch.font {
        for name in ["latin", "cs"] {
            let el = doc.ensure_child(rpr, Ns::A, name, R_PR_ORDER);
            doc.set_attr(el, "typeface", f);
            doc.remove_attr(el, "panose");
            doc.remove_attr(el, "pitchFamily");
            doc.remove_attr(el, "charset");
        }
    }
    if let Some(target) = &patch.link {
        if !target.trim().is_empty() && link.is_none() {
            return Err(Error::InvalidEdit("hyperlink relationship missing".into()));
        }
        set_run_link(doc, rpr, link);
    }
    super::effects::patch_run_effects(doc, rpr, patch.shadow.as_ref(), patch.glow.as_ref())
}

/// Applies character formatting to a range (or the whole body).
pub fn format_text(
    doc: &mut XmlDoc,
    body: NodeId,
    start: Option<TextPos>,
    end: Option<TextPos>,
    patch: &RunPatch,
    link: Option<&LinkRef>,
) -> Result<()> {
    let ps = paragraphs(doc, body);
    if ps.is_empty() {
        return Ok(());
    }
    let start = start.unwrap_or(TextPos {
        paragraph: 0,
        offset: 0,
    });
    let last = ps.len() - 1;
    let end = end.unwrap_or(TextPos {
        paragraph: last,
        offset: para_len(doc, ps[last]),
    });
    if end.paragraph > last || start.paragraph > end.paragraph {
        return Err(Error::InvalidEdit("format range out of bounds".into()));
    }
    for (i, &p) in ps
        .iter()
        .enumerate()
        .take(end.paragraph + 1)
        .skip(start.paragraph)
    {
        let len = para_len(doc, p);
        let from = if i == start.paragraph {
            start.offset.min(len)
        } else {
            0
        };
        let to = if i == end.paragraph {
            end.offset.min(len)
        } else {
            len
        };
        if to > from {
            split_at(doc, p, to);
            split_at(doc, p, from);
            let mut pos = 0;
            for (node, l) in items(doc, p) {
                if pos >= from && pos + l <= to && doc.local(node) != "br" {
                    let rpr = ensure_rpr(doc, node);
                    patch_rpr(doc, rpr, patch, link)?;
                }
                pos += l;
            }
        }
        // Formatting the paragraph end keeps new typing (and empty paragraphs) consistent.
        if to == len && (from == 0 || from < to) {
            let end_rpr = match doc.child(p, Ns::A, "endParaRPr") {
                Some(e) => e,
                None => {
                    let e = doc.create_element(Ns::A, "endParaRPr");
                    doc.set_attr(e, "lang", "en-US");
                    doc.append_child(p, e);
                    e
                }
            };
            let mut no_link = patch.clone();
            no_link.link = None;
            patch_rpr(doc, end_rpr, &no_link, None)?;
        }
    }
    Ok(())
}

/// Applies paragraph formatting to paragraphs `from..=to`.
pub fn format_paragraphs(
    doc: &mut XmlDoc,
    body: NodeId,
    from: Option<usize>,
    to: Option<usize>,
    patch: &ParaPatch,
) -> Result<()> {
    let ps = paragraphs(doc, body);
    if ps.is_empty() {
        return Ok(());
    }
    let from = from.unwrap_or(0);
    let to = to.unwrap_or(ps.len() - 1).min(ps.len() - 1);
    for &p in ps.iter().take(to + 1).skip(from) {
        let ppr = match doc.child(p, Ns::A, "pPr") {
            Some(x) => x,
            None => {
                let x = doc.create_element(Ns::A, "pPr");
                doc.insert_child(p, 0, x);
                x
            }
        };
        if let Some(a) = &patch.align {
            let v = match a.as_str() {
                "left" => "l",
                "center" => "ctr",
                "right" => "r",
                "justify" => "just",
                "distributed" => "dist",
                other => return Err(Error::InvalidEdit(format!("unknown alignment `{other}`"))),
            };
            doc.set_attr(ppr, "algn", v);
        }
        if let Some(l) = patch.level {
            if l > 8 {
                return Err(Error::InvalidEdit("level must be 0-8".into()));
            }
            doc.set_attr(ppr, "lvl", &l.to_string());
        }
        if let Some(m) = patch.margin_left {
            doc.set_attr(ppr, "marL", &pt_to_emu(f64::from(m)).to_string());
        }
        if let Some(i) = patch.indent {
            doc.set_attr(ppr, "indent", &pt_to_emu(f64::from(i)).to_string());
        }
        if let Some(ls) = patch.line_spacing {
            doc.remove_children_named(ppr, Ns::A, "lnSpc");
            let el = doc.create_element(Ns::A, "lnSpc");
            let pct = doc.create_element(Ns::A, "spcPct");
            doc.set_attr(pct, "val", &((ls * 100_000.0).round() as i64).to_string());
            doc.append_child(el, pct);
            doc.insert_in_order(ppr, el, P_PR_ORDER);
        }
        for (name, value) in [
            ("spcBef", patch.space_before),
            ("spcAft", patch.space_after),
        ] {
            if let Some(v) = value {
                doc.remove_children_named(ppr, Ns::A, name);
                let el = doc.create_element(Ns::A, name);
                let pts = doc.create_element(Ns::A, "spcPts");
                doc.set_attr(pts, "val", &((v * 100.0).round() as i64).to_string());
                doc.append_child(el, pts);
                doc.insert_in_order(ppr, el, P_PR_ORDER);
            }
        }
        if let Some(b) = &patch.bullet {
            for name in ["buNone", "buAutoNum", "buChar", "buBlip"] {
                doc.remove_children_named(ppr, Ns::A, name);
            }
            match b {
                BulletSpec::Inherit => {
                    for name in [
                        "buClrTx", "buClr", "buSzTx", "buSzPct", "buSzPts", "buFontTx", "buFont",
                    ] {
                        doc.remove_children_named(ppr, Ns::A, name);
                    }
                }
                BulletSpec::None => {
                    let el = doc.create_element(Ns::A, "buNone");
                    doc.insert_in_order(ppr, el, P_PR_ORDER);
                }
                BulletSpec::Char { char } => {
                    let el = doc.create_element(Ns::A, "buChar");
                    doc.set_attr(el, "char", char);
                    doc.insert_in_order(ppr, el, P_PR_ORDER);
                    if doc.attr(ppr, "marL").is_none() {
                        doc.set_attr(ppr, "marL", "285750");
                        doc.set_attr(ppr, "indent", "-285750");
                    }
                }
                BulletSpec::Number { scheme, start } => {
                    let el = doc.create_element(Ns::A, "buAutoNum");
                    doc.set_attr(el, "type", scheme);
                    if *start != 1 {
                        doc.set_attr(el, "startAt", &start.to_string());
                    }
                    doc.insert_in_order(ppr, el, P_PR_ORDER);
                    if doc.attr(ppr, "marL").is_none() {
                        doc.set_attr(ppr, "marL", "342900");
                        doc.set_attr(ppr, "indent", "-342900");
                    }
                }
            }
        }
    }
    Ok(())
}

/// Applies body (text box) properties.
pub fn format_body(doc: &mut XmlDoc, body: NodeId, patch: &BodyPatch) -> Result<()> {
    let bpr = match doc.child(body, Ns::A, "bodyPr") {
        Some(b) => b,
        None => {
            let b = doc.create_element(Ns::A, "bodyPr");
            doc.insert_child(body, 0, b);
            b
        }
    };
    if let Some(a) = &patch.anchor {
        let v = match a.as_str() {
            "top" => "t",
            "middle" => "ctr",
            "bottom" => "b",
            other => return Err(Error::InvalidEdit(format!("unknown anchor `{other}`"))),
        };
        doc.set_attr(bpr, "anchor", v);
    }
    if let Some(w) = patch.wrap {
        doc.set_attr(bpr, "wrap", if w { "square" } else { "none" });
    }
    if let Some(ins) = patch.insets {
        for (name, v) in ["lIns", "tIns", "rIns", "bIns"].iter().zip(ins) {
            doc.set_attr(bpr, name, &pt_to_emu(f64::from(v)).to_string());
        }
    }
    if let Some(c) = patch.columns {
        doc.set_attr(bpr, "numCol", &c.clamp(1, 16).to_string());
    }
    if let Some(d) = patch.direction {
        super::text_direction::write(doc, bpr, d);
    }
    if let Some(a) = &patch.autofit {
        for name in ["noAutofit", "normAutofit", "spAutoFit"] {
            doc.remove_children_named(bpr, Ns::A, name);
        }
        let name = match a.as_str() {
            "none" => "noAutofit",
            "shrink" => "normAutofit",
            "resize" => "spAutoFit",
            other => return Err(Error::InvalidEdit(format!("unknown autofit `{other}`"))),
        };
        let el = doc.create_element(Ns::A, name);
        doc.insert_in_order(bpr, el, BODY_PR_ORDER);
    }
    Ok(())
}

/// Replaces characters `start..end` of paragraph `p` with `text` (no breaks)
/// in the formatting of the first replaced character, whatever runs the
/// range spans. Returns `false`, changing nothing, when the range is empty or
/// touches a field (fields cannot be split).
pub fn replace_range(doc: &mut XmlDoc, p: NodeId, start: usize, end: usize, text: &str) -> bool {
    if end <= start {
        return false;
    }
    let mut pos = 0;
    for (node, len) in items(doc, p) {
        if doc.local(node) == "fld" && pos < end && start < pos + len {
            return false;
        }
        pos += len;
    }
    split_at(doc, p, end);
    split_at(doc, p, start);
    let mut replaced = Vec::new();
    let mut pos = 0;
    for (node, len) in items(doc, p) {
        if pos >= start && pos + len <= end && len > 0 {
            replaced.push(node);
        }
        pos += len;
    }
    let Some(&first) = replaced.first() else {
        return false;
    };
    if !text.is_empty() {
        if doc.local(first) == "r" {
            set_run_text(doc, first, text);
            replaced.remove(0);
        } else {
            // A line break carries its formatting in its own rPr.
            let template = doc.child(first, Ns::A, "rPr");
            let run = new_run(doc, text, template);
            doc.insert_before(first, run);
        }
    }
    for n in replaced {
        doc.detach(n);
    }
    true
}
