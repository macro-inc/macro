use super::order::{key_between, keys_between, reorder_keys};
use super::*;
use crate::edit::EditOp;
use crate::test_support::{deck, fonts, text_box};

fn para(text: &str) -> String {
    format!("<a:p><a:r><a:rPr lang=\"en-US\" sz=\"2000\"/><a:t>{text}</a:t></a:r></a:p>")
}

/// A two-slide deck seeded into shared entries, with two peers opened from them.
fn peers() -> (Entries, Presentation, Presentation) {
    let one = format!(
        "{}{}",
        text_box(2, 0, 0, 3_000_000, 500_000, &para("Title")),
        text_box(3, 0, 600_000, 3_000_000, 500_000, &para("Body"))
    );
    let two = text_box(2, 0, 0, 3_000_000, 500_000, &para("Second"));
    let mut seeding = Presentation::open(deck(&[&one, &two])).unwrap();
    seeding.enable_collab(1);
    let entries = Entries::from_changes(&seeding.collab_changes().unwrap());
    let a = Presentation::from_entries(entries.clone(), 2).unwrap();
    let b = Presentation::from_entries(entries.clone(), 3).unwrap();
    (entries, a, b)
}

fn ops(json: serde_json::Value) -> Vec<EditOp> {
    serde_json::from_value(json).unwrap()
}

fn edit(pres: &mut Presentation, json: serde_json::Value) -> Vec<EntryChange> {
    pres.apply(&ops(json), fonts()).unwrap();
    pres.collab_changes().unwrap()
}

fn texts(pres: &mut Presentation) -> Vec<Vec<String>> {
    pres.outline()
        .unwrap()
        .slides
        .into_iter()
        .map(|s| {
            s.shapes
                .into_iter()
                .map(|sh| {
                    sh.paragraphs
                        .iter()
                        .map(|p| p.text.as_str())
                        .collect::<Vec<_>>()
                        .join("\n")
                })
                .collect()
        })
        .collect()
}

fn assert_valid(pres: &mut Presentation) {
    let mut reopened = Presentation::open(pres.save().unwrap()).unwrap();
    let problems = reopened.integrity_problems().unwrap();
    assert!(problems.is_empty(), "{problems:#?}");
}

#[test]
fn seeding_describes_every_part_once() {
    let (entries, mut a, _) = peers();
    assert_eq!(entries.get(container::META, "format"), Some("1"));
    assert_eq!(entries.map(container::SLIDES).len(), 2);
    assert_eq!(entries.map(container::SLIDE_ORDER).len(), 2);
    // Two shapes on slide one, one on slide two, each with a position.
    assert_eq!(entries.map(container::SHAPES).len(), 3);
    assert_eq!(entries.map(container::SHAPE_ORDER).len(), 3);
    // Slides are stored without their shapes.
    let slide = entries
        .get(container::PARTS, "/ppt/slides/slide1.xml")
        .unwrap();
    assert!(!slide.contains("Title"), "{slide}");
    // A peer opened from the entries reads the same deck and owes nothing.
    assert_eq!(texts(&mut a), [vec!["Title", "Body"], vec!["Second"]]);
    assert!(a.collab_changes().unwrap().is_empty());
    assert_valid(&mut a);
}

#[test]
fn concurrent_edits_to_different_shapes_merge() {
    let (_, mut a, mut b) = peers();
    let slide = a.slides()[0].id;
    let from_a = edit(
        &mut a,
        serde_json::json!([{ "op": "setText", "slide": slide, "shape": 2, "text": "Title from A" }]),
    );
    let from_b = edit(
        &mut b,
        serde_json::json!([{ "op": "setText", "slide": slide, "shape": 3, "text": "Body from B" }]),
    );
    // Each edit touches one shape entry.
    assert_eq!(from_a.len(), 1, "{from_a:#?}");
    assert_eq!(from_a[0].container, container::SHAPES);
    let result = a.apply_collab_changes(&from_b).unwrap();
    assert_eq!(result.changed_slides, [slide]);
    assert!(!result.structure_changed);
    b.apply_collab_changes(&from_a).unwrap();
    let expected = [vec!["Title from A", "Body from B"], vec!["Second"]];
    assert_eq!(texts(&mut a), expected);
    assert_eq!(texts(&mut b), expected);
    assert_eq!(a.collab_entries(), b.collab_entries());
    // Applying remote changes owes nothing back.
    assert!(a.collab_changes().unwrap().is_empty());
    assert!(b.collab_changes().unwrap().is_empty());
    assert_valid(&mut a);
}

#[test]
fn concurrent_new_slides_and_shapes_never_collide() {
    let (_, mut a, mut b) = peers();
    let first = a.slides()[0].id;
    let from_a = edit(
        &mut a,
        serde_json::json!([
            { "op": "addSlide", "after": first, "title": "From A" },
            { "op": "addShape", "slide": first, "shape": { "kind": "textBox", "text": "Note A" }, "x": 10, "y": 300, "w": 200, "h": 40 }
        ]),
    );
    let from_b = edit(
        &mut b,
        serde_json::json!([
            { "op": "addSlide", "title": "From B" },
            { "op": "addShape", "slide": first, "shape": { "kind": "textBox", "text": "Note B" }, "x": 10, "y": 360, "w": 200, "h": 40 }
        ]),
    );
    let result = a.apply_collab_changes(&from_b).unwrap();
    assert!(result.structure_changed);
    b.apply_collab_changes(&from_a).unwrap();
    for pres in [&mut a, &mut b] {
        let outline = pres.outline().unwrap();
        let titles: Vec<_> = outline.slides.iter().map(|s| s.title.clone()).collect();
        assert_eq!(
            titles,
            [
                None,
                Some("From A".to_owned()),
                None,
                Some("From B".to_owned())
            ]
        );
        let first: Vec<_> = outline.slides[0]
            .shapes
            .iter()
            .flat_map(|s| s.paragraphs.iter().map(|p| p.text.clone()))
            .collect();
        assert_eq!(first, ["Title", "Body", "Note A", "Note B"]);
    }
    assert_eq!(a.collab_entries(), b.collab_entries());
    assert_valid(&mut a);
    assert_valid(&mut b);
}

#[test]
fn reordering_and_deleting_slides_merge() {
    let (_, mut a, mut b) = peers();
    let (one, two) = (a.slides()[0].id, a.slides()[1].id);
    let from_a = edit(
        &mut a,
        serde_json::json!([{ "op": "moveSlide", "slide": two, "to": 0 }]),
    );
    // A move rewrites one position key, not the slide list.
    assert!(
        from_a.iter().all(|c| c.container == container::SLIDE_ORDER),
        "{from_a:#?}"
    );
    let from_b = edit(
        &mut b,
        serde_json::json!([{ "op": "setText", "slide": one, "shape": 3, "text": "Edited" }]),
    );
    a.apply_collab_changes(&from_b).unwrap();
    b.apply_collab_changes(&from_a).unwrap();
    let expected = [vec!["Second"], vec!["Title", "Edited"]];
    assert_eq!(texts(&mut a), expected);
    assert_eq!(texts(&mut b), expected);

    let from_b = edit(
        &mut b,
        serde_json::json!([{ "op": "deleteSlide", "slide": two }]),
    );
    let result = a.apply_collab_changes(&from_b).unwrap();
    assert!(result.structure_changed);
    assert_eq!(texts(&mut a), [vec!["Title", "Edited"]]);
    assert_eq!(a.collab_entries(), b.collab_entries());
    assert_valid(&mut a);
}

#[test]
fn undoing_through_the_entries_restores_the_shape() {
    let (entries, mut a, mut b) = peers();
    let slide = a.slides()[0].id;
    let forward = edit(
        &mut a,
        serde_json::json!([{ "op": "setText", "slide": slide, "shape": 2, "text": "Changed" }]),
    );
    b.apply_collab_changes(&forward).unwrap();
    // The inverse of a change is the old value of the same entries.
    let inverse: Vec<EntryChange> = forward
        .iter()
        .map(|c| EntryChange {
            value: entries.get(&c.container, &c.key).map(str::to_owned),
            ..c.clone()
        })
        .collect();
    a.apply_collab_changes(&inverse).unwrap();
    b.apply_collab_changes(&inverse).unwrap();
    assert_eq!(texts(&mut a)[0], ["Title", "Body"]);
    assert_eq!(texts(&mut b)[0], ["Title", "Body"]);
}

#[test]
fn fractional_keys_order_and_reuse() {
    let keys = keys_between(None, None, 5);
    assert!(keys.windows(2).all(|w| w[0] < w[1]), "{keys:?}");
    let between = key_between(Some(&keys[1]), Some(&keys[2]));
    assert!(keys[1] < between && between < keys[2]);
    let existing: BTreeMap<String, String> = ["a", "b", "c"]
        .iter()
        .zip(&keys)
        .map(|(id, key)| ((*id).to_owned(), key.clone()))
        .collect();
    // Moving one item rewrites only its key.
    let order: Vec<String> = ["b", "c", "a"].iter().map(|s| (*s).to_owned()).collect();
    let changed = reorder_keys(&existing, &order);
    assert_eq!(changed.len(), 1, "{changed:?}");
    assert!(changed["a"] > existing["c"]);
    // Inserting gives only the new item a key.
    let order: Vec<String> = ["a", "new", "b", "c"]
        .iter()
        .map(|s| (*s).to_owned())
        .collect();
    let changed = reorder_keys(&existing, &order);
    assert_eq!(changed.keys().collect::<Vec<_>>(), ["new"]);
    assert!(existing["a"] < changed["new"] && changed["new"] < existing["b"]);
}
