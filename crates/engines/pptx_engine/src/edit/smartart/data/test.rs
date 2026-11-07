//! Data model tests: the node tree and its text-pane edits.

use super::{IdGen, Model, NewNodes, PtKind, Tree, write_tree};
use crate::xml::XmlDoc;
use std::collections::HashMap;

/// A tree from `(id, parent)` pairs in order (`""` = top level).
fn tree(nodes: &[(&str, &str)]) -> Tree {
    let mut children: HashMap<String, Vec<String>> = HashMap::new();
    let mut kinds = HashMap::from([("doc".to_owned(), PtKind::Doc)]);
    for (id, parent) in nodes {
        let parent = if parent.is_empty() { "doc" } else { parent };
        children
            .entry(parent.to_string())
            .or_default()
            .push(id.to_string());
        kinds.insert(id.to_string(), PtKind::Node);
    }
    Tree {
        root: "doc".into(),
        children,
        kinds,
    }
}

/// `id:depth` in text-pane order.
fn outline(t: &Tree) -> String {
    t.preorder()
        .into_iter()
        .map(|(id, d)| format!("{id}:{d}"))
        .collect::<Vec<_>>()
        .join(" ")
}

#[test]
fn adds_nodes_like_add_shape() {
    let mut t = tree(&[("a", ""), ("b", ""), ("b1", "b")]);
    t.add_after("a", "n1").unwrap();
    assert_eq!(outline(&t), "a:1 n1:1 b:1 b1:2");
    t.add_before("a", "n2").unwrap();
    assert_eq!(outline(&t), "n2:1 a:1 n1:1 b:1 b1:2");
    t.add_below("b", "n3").unwrap();
    assert_eq!(outline(&t), "n2:1 a:1 n1:1 b:1 b1:2 n3:2");
    t.add_above("b1", "n4").unwrap();
    assert_eq!(outline(&t), "n2:1 a:1 n1:1 b:1 n4:2 b1:3 n3:2");
    t.add_assistant("a", "n5").unwrap();
    assert_eq!(t.kinds["n5"], PtKind::Asst);
    t.add_last("n6");
    assert!(outline(&t).ends_with("n6:1"));
    assert!(t.add_after("missing", "x").is_err());
}

#[test]
fn promotes_and_demotes_like_the_text_pane() {
    let mut t = tree(&[("a", ""), ("b", ""), ("c", ""), ("d", "")]);
    t.demote("b").unwrap();
    assert_eq!(outline(&t), "a:1 b:2 c:1 d:1");
    t.demote("c").unwrap();
    t.demote("c").unwrap();
    assert_eq!(outline(&t), "a:1 b:2 c:3 d:1");
    // The first node of a level cannot go down.
    assert!(t.demote("a").is_err());
    // Promoting b adopts its following siblings... none here; c comes along as its child.
    t.promote("b").unwrap();
    assert_eq!(outline(&t), "a:1 b:1 c:2 d:1");
    assert!(t.promote("a").is_err());
    // Promote with following siblings: they become its children.
    let mut t = tree(&[("p", ""), ("x", "p"), ("y", "p"), ("z", "p")]);
    t.promote("x").unwrap();
    assert_eq!(outline(&t), "p:1 x:1 y:2 z:2");
}

#[test]
fn deletes_and_moves_nodes() {
    let mut t = tree(&[("a", ""), ("a1", "a"), ("a2", "a"), ("b", "")]);
    t.delete("a").unwrap();
    assert_eq!(outline(&t), "a1:1 a2:1 b:1");
    t.move_by("b", true).unwrap();
    assert_eq!(outline(&t), "a1:1 b:1 a2:1");
    t.move_by("a1", false).unwrap();
    assert_eq!(outline(&t), "b:1 a1:1 a2:1");
    assert!(t.move_by("b", true).is_err());
    assert!(t.move_by("a2", false).is_err());
}

const DATA: &str = r#"<dgm:dataModel xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><dgm:ptLst><dgm:pt modelId="0" type="doc"><dgm:prSet loTypeId="urn:microsoft.com/office/officeart/2005/8/layout/default"/></dgm:pt><dgm:pt modelId="1"><dgm:t><a:bodyPr/><a:p><a:r><a:rPr lang="en-US" b="1"/><a:t>One</a:t></a:r></a:p></dgm:t></dgm:pt><dgm:pt modelId="2"><dgm:t><a:bodyPr/><a:p><a:r><a:t>Two</a:t></a:r></a:p></dgm:t></dgm:pt><dgm:pt modelId="t1" type="parTrans" cxnId="c1"/><dgm:pt modelId="t2" type="sibTrans" cxnId="c1"/><dgm:pt modelId="t3" type="parTrans" cxnId="c2"/><dgm:pt modelId="t4" type="sibTrans" cxnId="c2"/><dgm:pt modelId="p1" type="pres"><dgm:prSet presName="node" custScaleX="50000"/></dgm:pt></dgm:ptLst><dgm:cxnLst><dgm:cxn modelId="c1" srcId="0" destId="1" srcOrd="0" destOrd="0" parTransId="t1" sibTransId="t2"/><dgm:cxn modelId="c2" srcId="0" destId="2" srcOrd="1" destOrd="0" parTransId="t3" sibTransId="t4"/><dgm:cxn modelId="c3" type="presOf" srcId="1" destId="p1" srcOrd="0" destOrd="0"/></dgm:cxnLst></dgm:dataModel>"#;

#[test]
fn reads_the_model_and_its_customizations() {
    let doc = XmlDoc::parse(DATA.as_bytes(), "data").unwrap();
    let model = Model::read(&doc).unwrap();
    let t = model.tree();
    assert_eq!(outline(&t), "1:1 2:1");
    assert_eq!(super::node_text(&doc, model.point("1").unwrap().el), "One");
    assert!(model.customized(&doc));
    assert_eq!(model.pres_sources("p1").len(), 1);
}

#[test]
fn writes_the_tree_back_keeping_nodes_and_transitions() {
    let mut doc = XmlDoc::parse(DATA.as_bytes(), "data").unwrap();
    let mut t = Model::read(&doc).unwrap().tree();
    let mut ids = IdGen::new(None, "data", &doc);
    let new_id = ids.next();
    t.add_below("1", &new_id).unwrap();
    t.delete("2").unwrap();
    let new: NewNodes = HashMap::from([(new_id.clone(), Some("Three".to_owned()))]);
    write_tree(&mut doc, &t, &new, &mut ids).unwrap();
    let model = Model::read(&doc).unwrap();
    assert_eq!(outline(&model.tree()), format!("1:1 {new_id}:2"));
    // Node 1 keeps its formatting and its connection's transitions.
    assert!(
        String::from_utf8(doc.to_bytes())
            .unwrap()
            .contains("b=\"1\"")
    );
    assert!(model.point("t1").is_some() && model.point("t2").is_some());
    // Node 2, its connection, and its transitions are gone.
    assert!(model.point("2").is_none() && model.point("t3").is_none());
    assert!(model.cxns.iter().all(|c| c.id != "c2"));
    // Presentation points are dropped for PowerPoint to rebuild.
    assert!(model.points.iter().all(|p| p.kind != PtKind::Pres));
    assert!(!model.customized(&doc));
    // The new node has its text, a connection, and two transitions.
    assert_eq!(
        super::node_text(&doc, model.point(&new_id).unwrap().el),
        "Three"
    );
    let cxn = model.cxns.iter().find(|c| c.dest == new_id).unwrap();
    assert_eq!(cxn.src, "1");
    let trans = model
        .points
        .iter()
        .filter(|p| p.cxn.as_deref() == Some(&cxn.id))
        .count();
    assert_eq!(trans, 2);
}
