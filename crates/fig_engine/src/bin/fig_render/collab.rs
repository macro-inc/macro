//! `fig_render collab`: edits a file as one person and checks that a second
//! person, both saves, and someone joining later from the saved file all
//! end up with the same design.

use super::{open, stem};
use fig_engine::collab::{Collab, EntryChange, container, meta};
use fig_engine::edit::{History, Op};
use fig_engine::images::ImageStore;
use fig_engine::model::NodeType;
use fig_engine::render::{self, RenderOptions, Viewport};
use fig_engine::{Document, Scene};
use std::collections::BTreeMap;
use std::path::Path;
use std::time::Instant;

/// Every page, at most 512 px on its long side.
fn renders(doc: &Document) -> Vec<Vec<u8>> {
    doc.pages
        .iter()
        .map(|&page| {
            let scene = Scene::build(doc, page);
            let b = scene.node(scene.root()).bounds;
            if b.is_empty() {
                return Vec::new();
            }
            let scale = (512.0 / b.w.max(b.h)).min(1.0);
            render::render(
                doc,
                &scene,
                &mut ImageStore::default(),
                &Viewport {
                    x: b.x,
                    y: b.y,
                    scale,
                    width: ((b.w * scale).ceil() as u32).max(1),
                    height: ((b.h * scale).ceil() as u32).max(1),
                },
                RenderOptions {
                    outline: false,
                    background: Some(doc.page_background(page)),
                },
            )
            .map(|p| p.take())
            .unwrap_or_default()
        })
        .collect()
}

/// Edit steps on the first page's layers, as the editor sends them.
fn steps(doc: &Document) -> Vec<String> {
    let page = doc.pages[0];
    let page_id = doc.props(page).guid.unwrap_or_default();
    let top: Vec<String> = doc
        .node(page)
        .children
        .iter()
        .filter_map(|&c| doc.props(c).guid.map(|g| g.to_string()))
        .collect();
    let mut out = Vec::new();
    if let Some(first) = top.first() {
        out.push(format!(
            r#"[{{"op":"translate","ids":["{first}"],"dx":23,"dy":-11}}]"#
        ));
        out.push(format!(
            r#"[{{"op":"duplicate","ids":["{first}"],"dx":40,"dy":40}}]"#
        ));
    }
    if let Some(second) = top.get(1) {
        out.push(format!(
            r#"[{{"op":"set","ids":["{second}"],"props":{{"opacity":0.5,"name":"Collab check"}}}}]"#
        ));
    }
    // A text layer and a vector anywhere on the page (not in instances).
    let mut stack = vec![page];
    let (mut text, mut vector) = (None, None);
    while let Some(i) = stack.pop() {
        let p = doc.props(i);
        match p.node_type() {
            NodeType::Text if text.is_none() => text = p.guid,
            NodeType::Vector if vector.is_none() && p.fill_geometry.is_some() => vector = p.guid,
            _ => {}
        }
        stack.extend(doc.node(i).children.iter().copied());
    }
    if let Some(t) = text {
        out.push(format!(
            r#"[{{"op":"set","ids":["{t}"],"props":{{"characters":"Edited together"}}}}]"#
        ));
    }
    if let Some(v) = vector {
        let w = doc.find(v).map_or(10.0, |i| doc.props(i).size().x * 1.5);
        out.push(format!(
            r#"[{{"op":"set","ids":["{v}"],"props":{{"width":{w}}}}}]"#
        ));
    }
    // Deleting a layer (with whatever components it holds) after editing.
    if top.len() > 2
        && let Some(last) = top.last()
    {
        out.push(format!(r#"[{{"op":"delete","ids":["{last}"]}}]"#));
    }
    out.push(format!(
        r#"[{{"op":"create","parent":"{page_id}","node":{{"type":"RECTANGLE","x":-200,"y":-200,"width":120,"height":80,"props":{{"fills":[{{"color":"FF00AA"}}]}}}}}}]"#
    ));
    out.push(format!(
        r#"[{{"op":"create","parent":"{page_id}","node":{{"type":"TEXT","x":-200,"y":-80,"width":1,"height":1,"props":{{"characters":"New text","fontSize":32}}}}}}]"#
    ));
    out
}

pub fn check(path: &Path) {
    let Some((bytes, mut a)) = open(path) else {
        return;
    };
    let started = Instant::now();
    let mut b = Document::open(&bytes).expect("opened once already");
    let (mut ca, meta_changes) = Collab::new(&mut a, 1001, None);
    let base = meta_changes
        .iter()
        .find(|c| c.key == meta::BASE_BLOBS)
        .and_then(|c| c.value.as_deref()?.parse().ok());
    let (mut cb, _) = Collab::new(&mut b, 1002, base);
    let mut shared: BTreeMap<(String, String), Option<String>> = BTreeMap::new();
    let publish = |changes: &[EntryChange], shared: &mut BTreeMap<_, _>| {
        for c in changes {
            shared.insert((c.container.clone(), c.key.clone()), c.value.clone());
        }
    };
    publish(&meta_changes, &mut shared);

    let mut history = History::default();
    let mut applied = 0;
    for json in steps(&a) {
        let Ok(ops) = serde_json::from_str::<Vec<Op>>(&json) else {
            continue;
        };
        let Ok(step) = history.apply(&mut a, &ops, None) else {
            continue;
        };
        applied += 1;
        let mut touched = step.touched;
        ca.record(&mut a, &mut touched, false);
        let changes = ca.changes(&a);
        cb.apply(&mut b, &changes);
        publish(&changes, &mut shared);
    }
    // Undo the last step, as an ordinary change.
    if let Some(mut touched) = history.undo(&mut a) {
        ca.record(&mut a, &mut touched, true);
        let changes = ca.changes(&a);
        cb.apply(&mut b, &changes);
        publish(&changes, &mut shared);
    }
    let took = started.elapsed();
    let entries: Vec<EntryChange> = shared
        .iter()
        .map(|((container, key), value)| EntryChange {
            container: container.clone(),
            key: key.clone(),
            value: value.clone(),
        })
        .collect();
    let size: usize = entries
        .iter()
        .map(|e| e.value.as_ref().map_or(0, String::len))
        .sum();
    let nodes = entries
        .iter()
        .filter(|e| e.container == container::NODES)
        .count();

    let live = renders(&a);
    let peer = live == renders(&b);
    let saves = match (
        fig_engine::save::save(&a, &bytes),
        fig_engine::save::save(&b, &bytes),
    ) {
        (Ok(sa), Ok(sb)) => Some((sa, sb)),
        (Err(e), _) | (_, Err(e)) => {
            println!("{}: SAVE ERROR {e}", stem(path));
            None
        }
    };
    let Some((saved_a, saved_b)) = saves else {
        return;
    };
    let (Ok(ra), Ok(rb)) = (Document::open(&saved_a), Document::open(&saved_b)) else {
        println!("{}: REOPEN ERROR", stem(path));
        return;
    };
    let same_saves = renders(&ra) == renders(&rb);
    // Someone opening the merged file applies every entry again.
    let mut joiner = ra;
    let (mut cj, _) = Collab::new(&mut joiner, 1003, base);
    cj.apply(&mut joiner, &entries);
    let joined = renders(&joiner) == live;
    let verdict = |ok: bool| if ok { "identical" } else { "DIFFER" };
    println!(
        "{}: {applied} steps, {nodes} node entries ({} KB) in {took:?}; peer {}, saves {}, joiner {}",
        stem(path),
        size / 1024,
        verdict(peer),
        verdict(same_saves),
        verdict(joined),
    );
}
