//! `fig_render prototype`: reads each file's prototype (flows, screens,
//! interactions), edits it the way the Prototype tab does, saves, reopens,
//! and checks the reopened file reads the same.

use fig_engine::edit::{History, Op};
use fig_engine::inspect::prototype::{PrototypeInfo, prototype};
use fig_engine::{Document, Scene};
use std::collections::BTreeMap;
use std::path::Path;

fn page_info(doc: &Document, page: usize) -> PrototypeInfo {
    let scene = Scene::build(doc, doc.pages[page]);
    prototype(doc, &scene)
}

fn as_json(doc: &Document) -> Vec<String> {
    (0..doc.pages.len())
        .map(|p| serde_json::to_string(&page_info(doc, p)).unwrap_or_default())
        .collect()
}

/// The edits: the first top-level hotspot's first action dissolves, and
/// the first screen without a flow starts one.
fn edits(doc: &Document) -> Option<(usize, String)> {
    for page in 0..doc.pages.len() {
        let info = page_info(doc, page);
        let Some(h) = info.hotspots.iter().find(|h| !h.id.starts_with('I')) else {
            continue;
        };
        let interactions: Vec<serde_json::Value> = h
            .interactions
            .iter()
            .enumerate()
            .map(|(k, i)| {
                let actions: Vec<serde_json::Value> = i
                    .actions
                    .iter()
                    .map(|_| {
                        if k == 0 {
                            serde_json::json!({"transition": "DISSOLVE", "duration": 0.45})
                        } else {
                            serde_json::json!({})
                        }
                    })
                    .collect();
                serde_json::json!({"id": i.id, "actions": actions})
            })
            .collect();
        let mut ops = vec![serde_json::json!({
            "op": "setInteractions", "id": h.id, "interactions": interactions,
        })];
        let flows: Vec<&str> = info.flows.iter().map(|f| f.frame.as_str()).collect();
        if let Some(screen) = info
            .frames
            .iter()
            .find(|f| !flows.contains(&f.id.as_str()) && !f.id.starts_with('I'))
        {
            ops.push(
                serde_json::json!({"op": "setFlowStart", "id": screen.id, "name": "Checked flow"}),
            );
        }
        return Some((page, serde_json::Value::Array(ops).to_string()));
    }
    None
}

pub fn check(path: &Path) {
    let name = path.display();
    let Ok(bytes) = std::fs::read(path) else {
        println!("{name}: unreadable");
        return;
    };
    let mut doc = match Document::open(&bytes) {
        Ok(d) => d,
        Err(e) => {
            println!("{name}: {e}");
            return;
        }
    };
    let mut kinds: BTreeMap<String, usize> = BTreeMap::new();
    let (mut flows, mut screens, mut hotspots) = (0, 0, 0);
    for page in 0..doc.pages.len() {
        let info = page_info(&doc, page);
        flows += info.flows.len();
        screens += info.frames.len();
        hotspots += info.hotspots.len();
        for h in &info.hotspots {
            for i in &h.interactions {
                for a in &i.actions {
                    let kind = match a.connection.as_str() {
                        "INTERNAL_NODE" => a.navigation.clone(),
                        other => other.to_owned(),
                    };
                    *kinds.entry(format!("{}/{kind}", i.trigger)).or_default() += 1;
                }
            }
        }
    }
    print!("{name}: {flows} flows, {screens} screens, {hotspots} hotspots {kinds:?}");
    let Some((_, json)) = edits(&doc) else {
        println!(" (nothing to edit)");
        return;
    };
    let ops: Vec<Op> = serde_json::from_str(&json).expect("ops");
    if let Err(e) = History::default().apply(&mut doc, &ops, None) {
        println!(" EDIT FAILED: {e}");
        return;
    }
    let saved = match fig_engine::save::save(&doc, &bytes) {
        Ok(s) => s,
        Err(e) => {
            println!(" SAVE FAILED: {e}");
            return;
        }
    };
    match Document::open(&saved) {
        Ok(reopened) if as_json(&reopened) == as_json(&doc) => println!(" saved ok"),
        Ok(_) => println!(" REOPENED DIFFERENTLY"),
        Err(e) => println!(" REOPEN FAILED: {e}"),
    }
}
