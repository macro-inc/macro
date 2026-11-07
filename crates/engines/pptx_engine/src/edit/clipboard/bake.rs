//! Turning a copied placeholder into an ordinary shape that looks the same:
//! the transform, geometry, fill, outline, body properties, and list styles
//! it inherited from its layout and master are written into it.

use super::has_references;
use crate::edit::xmlutil::{
    BODY_PR_ORDER, FILL_NAMES, P_PR_ORDER, R_PR_ORDER, SP_PR_ORDER, ensure_sp_pr,
};
use crate::model::presentation::{PartRef, SlideContext};
use crate::model::shape::placeholder_of;
use crate::xml::{NodeId, Ns, XmlDoc};

/// The grouping key of a formatting child: elements of one choice group
/// (fills, bullet kinds, autofit kinds...) replace each other.
fn choice_group(local: &str) -> &str {
    match local {
        "noAutofit" | "normAutofit" | "spAutoFit" => "autofit",
        "buClrTx" | "buClr" => "buClr",
        "buSzTx" | "buSzPct" | "buSzPts" => "buSz",
        "buFontTx" | "buFont" => "buFont",
        "buNone" | "buAutoNum" | "buChar" | "buBlip" => "bullet",
        "noFill" | "solidFill" | "gradFill" | "blipFill" | "pattFill" | "grpFill" => "fill",
        "effectLst" | "effectDag" => "effect",
        "uLnTx" | "uLn" => "uLn",
        "uFillTx" | "uFill" => "uFill",
        other => other,
    }
}

/// Overlays formatting element `src` (of `src_doc`) onto `dst`: attributes
/// replace attributes, children replace children of the same choice group,
/// and `defRPr` merges the same way.
fn overlay(doc: &mut XmlDoc, dst: NodeId, src_doc: &XmlDoc, src: NodeId, order: &[&str]) {
    for a in src_doc.attrs(src) {
        if a.ns().0 < Ns::FIRST_DYNAMIC {
            doc.set_attr_ns(dst, a.ns(), a.local(), a.value());
        }
    }
    for c in src_doc.children(src).collect::<Vec<_>>() {
        let local = src_doc.local(c);
        if local == "extLst" || has_references(src_doc, c) {
            continue;
        }
        if local == "defRPr"
            && let Some(existing) = doc.child(dst, Ns::A, "defRPr")
        {
            overlay(doc, existing, src_doc, c, R_PR_ORDER);
            continue;
        }
        let key = choice_group(local).to_owned();
        let doomed: Vec<NodeId> = doc
            .children(dst)
            .filter(|&d| choice_group(doc.local(d)) == key)
            .collect();
        for d in doomed {
            doc.detach(d);
        }
        let imported = doc.import(src_doc, c);
        doc.insert_in_order(dst, imported, order);
    }
}

/// The `txBody` of a shape element.
fn tx_body(doc: &XmlDoc, shape: NodeId) -> Option<NodeId> {
    doc.children(shape).find(|&c| doc.local(c) == "txBody")
}

/// The properties element (`spPr`) of a shape element.
fn sp_pr_of(doc: &XmlDoc, shape: NodeId) -> Option<NodeId> {
    doc.children(shape).find(|&c| doc.local(c) == "spPr")
}

/// Makes the placeholder copy `top` an ordinary shape that looks the same:
/// the transform, geometry, fill, outline, and text formatting it inherited
/// through `chain` (itself, its layout and master placeholders) are written
/// into it, and its placeholder identity is removed.
pub(super) fn bake_placeholder(
    doc: &mut XmlDoc,
    top: NodeId,
    chain: &[(PartRef, NodeId)],
    ctx: &SlideContext,
) {
    let inherited = chain.get(1..).unwrap_or_default();
    let local = doc.local(top).to_owned();
    if matches!(local.as_str(), "sp" | "pic") {
        let sp_pr = ensure_sp_pr(doc, top);
        let has = |doc: &XmlDoc, names: &[&str]| {
            doc.children(sp_pr).any(|c| names.contains(&doc.local(c)))
        };
        let wanted: [&[&str]; 5] = [
            &["xfrm"],
            &["prstGeom", "custGeom"],
            FILL_NAMES,
            &["ln"],
            &["effectLst", "effectDag"],
        ];
        for names in wanted {
            if has(doc, names) {
                continue;
            }
            let source = inherited.iter().find_map(|(p, n)| {
                let pr = sp_pr_of(&p.doc, *n)?;
                p.doc
                    .children(pr)
                    .find(|&c| names.contains(&p.doc.local(c)))
                    .map(|c| (p, c))
            });
            // Picture fills reference the layout's or master's relationships.
            if let Some((p, el)) = source
                && !has_references(&p.doc, el)
            {
                let imported = doc.import(&p.doc, el);
                doc.insert_in_order(sp_pr, imported, SP_PR_ORDER);
            }
        }
    }
    if local == "sp"
        && let Some(body) = tx_body(doc, top)
    {
        bake_text_style(doc, body, chain, ctx);
    }
    strip_placeholder(doc, top);
}

/// Writes the body properties and list styles a placeholder's text inherits
/// into its own `bodyPr` and `lstStyle`.
fn bake_text_style(
    doc: &mut XmlDoc,
    body: NodeId,
    chain: &[(PartRef, NodeId)],
    ctx: &SlideContext,
) {
    let Some((own_part, own)) = chain.first() else {
        return;
    };
    let family = placeholder_of(&own_part.doc, *own).map_or("other", |p| p.style_family());
    // Inherited first (master, then layout), the shape's own last.
    let bodies: Vec<(&XmlDoc, NodeId)> = chain
        .iter()
        .rev()
        .filter_map(|(p, n)| tx_body(&p.doc, *n).map(|b| (&*p.doc, b)))
        .collect();
    let body_pr = doc.create_element(Ns::A, "bodyPr");
    for (src, b) in &bodies {
        if let Some(pr) = src.child(*b, Ns::A, "bodyPr") {
            overlay(doc, body_pr, src, pr, BODY_PR_ORDER);
        }
    }
    let mut lists: Vec<(&XmlDoc, NodeId)> = Vec::new();
    let style_name = match family {
        "title" => "titleStyle",
        "body" => "bodyStyle",
        _ => "otherStyle",
    };
    // Shapes copied from a master take its own text styles.
    let master = ctx.master.as_ref().or_else(|| {
        ctx.slide
            .doc
            .is(ctx.slide.doc.root(), Ns::P, "sldMaster")
            .then_some(&ctx.slide)
    });
    if let Some(master) = master
        && let Some(style) = master
            .doc
            .path(master.doc.root(), Ns::P, &["txStyles", style_name])
    {
        lists.push((&master.doc, style));
    }
    lists.extend(
        bodies
            .iter()
            .filter_map(|(src, b)| src.child(*b, Ns::A, "lstStyle").map(|l| (*src, l))),
    );
    let lst_style = doc.create_element(Ns::A, "lstStyle");
    for level in 1..=9 {
        let name = format!("lvl{level}pPr");
        let sources: Vec<(&XmlDoc, NodeId)> = lists
            .iter()
            .filter_map(|(src, l)| src.child(*l, Ns::A, &name).map(|n| (*src, n)))
            .collect();
        if sources.is_empty() {
            continue;
        }
        let merged = doc.create_element(Ns::A, &name);
        for (src, n) in sources {
            overlay(doc, merged, src, n, P_PR_ORDER);
        }
        // Titles never take a bullet from the deck's default text style.
        if family == "title"
            && !doc
                .children(merged)
                .any(|c| choice_group(doc.local(c)) == "bullet")
        {
            let none = doc.create_element(Ns::A, "buNone");
            doc.insert_in_order(merged, none, P_PR_ORDER);
        }
        doc.append_child(lst_style, merged);
    }
    doc.remove_children_named(body, Ns::A, "bodyPr");
    doc.remove_children_named(body, Ns::A, "lstStyle");
    doc.insert_child(body, 0, lst_style);
    doc.insert_child(body, 0, body_pr);
}

/// Removes a shape's placeholder identity (`p:ph` and the grouping lock).
fn strip_placeholder(doc: &mut XmlDoc, shape: NodeId) {
    let Some(nv) = doc
        .children(shape)
        .find(|&c| doc.local(c).starts_with("nv"))
    else {
        return;
    };
    if let Some(ph) = doc
        .child(nv, Ns::P, "nvPr")
        .and_then(|n| doc.child(n, Ns::P, "ph"))
    {
        doc.detach(ph);
    }
    let Some(c_nv) = doc
        .children(nv)
        .find(|&c| doc.local(c).starts_with("cNv") && doc.local(c) != "cNvPr")
    else {
        return;
    };
    let locks = doc
        .children(c_nv)
        .find(|&c| doc.local(c).ends_with("Locks"));
    if let Some(locks) = locks {
        doc.remove_attr(locks, "noGrp");
        if doc.attrs(locks).next().is_none() && doc.first_child(locks).is_none() {
            doc.detach(locks);
        }
    }
    if doc.local(shape) == "sp" && tx_body(doc, shape).is_some() {
        doc.set_attr(c_nv, "txBox", "1");
    }
}
