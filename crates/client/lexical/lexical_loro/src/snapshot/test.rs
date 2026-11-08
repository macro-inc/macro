use super::*;
use loro::{Container, ContainerTrait, ValueOrContainer};
use serde_json::json;

#[test]
fn snapshot_retains_frozen_ancestor_containers_and_exact_deep_state() -> Result<()> {
    assert_eq!(golden::MARKDOWN_GOLDEN.len(), 784);
    let base = LoroDoc::new();
    base.import(golden::MARKDOWN_GOLDEN)?;
    let root = base.get_map("root");
    let state = root.get("$").expect("golden state");
    let children = root.get("children").expect("golden children");
    let raw = json!({"root":{"$":{"id":"new-root"},"type":"root","version":1,"format":"","indent":0,"direction":null,"children":[{"$":{"id":"p"},"type":"paragraph","version":1,"children":[{"$":{"id":"t"},"type":"text","version":1,"text":"a😀b"}]}]}});
    let bytes = raw_state_to_loro_snapshot(&raw, Some(golden::MARKDOWN_GOLDEN))?;
    let doc = LoroDoc::new();
    doc.import(&bytes)?;
    assert_eq!(schema::from_loro(&doc.get_deep_value())?, raw);
    assert_eq!(doc.get_map("root").id(), root.id());
    for (name, original) in [("$", state), ("children", children)] {
        let ValueOrContainer::Container(original) = original else {
            panic!("golden container");
        };
        let Some(ValueOrContainer::Container(current)) = doc.get_map("root").get(name) else {
            panic!("snapshot container");
        };
        assert_eq!(current.id(), original.id());
    }
    Ok(())
}

#[test]
fn snapshot_mirror_deletes_before_moving_and_preserves_surviving_map_ids() -> Result<()> {
    let doc = new_doc(31)?;
    let initial = json!({"type":"root","children":[{"$":{"id":"a"},"type":"paragraph","children":[]},{"$":{"id":"b"},"type":"paragraph","children":[]},{"$":{"id":"c"},"type":"paragraph","children":[]}]});
    mirror::set_state(&doc, &initial)?;
    let list = schema::children(&doc.get_map("root"))?.expect("children");
    let b = schema::map_at(list.get(1), "b")?.id();
    let c = schema::map_at(list.get(2), "c")?.id();
    let next = json!({"type":"root","children":[{"$":{"id":"c"},"type":"paragraph","children":[]},{"$":{"id":"b"},"type":"paragraph","children":[]}]});
    mirror::set_state(&doc, &next)?;
    assert_eq!(
        schema::from_loro(&doc.get_map("root").get_deep_value())?,
        next
    );
    assert_eq!(schema::map_at(list.get(0), "c")?.id(), c);
    assert_eq!(schema::map_at(list.get(1), "b")?.id(), b);
    Ok(())
}

#[test]
fn snapshot_mirror_new_null_text_is_an_empty_text_container() -> Result<()> {
    let doc = new_doc(32)?;
    mirror::set_state(&doc, &json!({"type":"root","children":[]}))?;
    mirror::set_state(&doc, &json!({"type":"root","text":null,"children":[]}))?;
    let Some(ValueOrContainer::Container(Container::Text(text))) = doc.get_map("root").get("text")
    else {
        panic!("declared text container");
    };
    assert_eq!(text.to_string(), "");
    Ok(())
}

#[test]
fn snapshot_mirror_preserves_maps_across_permutations_and_deletions() -> Result<()> {
    let source = ["a", "b", "c", "d"];
    let initial: Vec<_> = source
        .iter()
        .map(|id| json!({"type":"paragraph","$":{"id":id},"children":[]}))
        .collect();
    for a in source {
        for b in source {
            for c in source {
                for d in source {
                    let order = [a, b, c, d];
                    if order
                        .iter()
                        .copied()
                        .collect::<std::collections::HashSet<_>>()
                        .len()
                        != 4
                    {
                        continue;
                    }
                    for deleted in [None, Some("a"), Some("b"), Some("c"), Some("d")] {
                        let doc = new_doc(47)?;
                        mirror::set_state(&doc, &json!({"type":"root","children":initial}))?;
                        let list = schema::children(&doc.get_map("root"))?.expect("list");
                        let original: std::collections::HashMap<_, _> = source
                            .iter()
                            .enumerate()
                            .map(|(index, id)| {
                                Ok((*id, schema::map_at(list.get(index), "original")?.id()))
                            })
                            .collect::<Result<_>>()?;
                        let retained: Vec<_> =
                            order.iter().filter(|id| Some(**id) != deleted).collect();
                        let children: Vec<_> = retained
                            .iter()
                            .map(|id| json!({"type":"paragraph","$":{"id":id},"children":[]}))
                            .collect();
                        let expected = json!({"type":"root","children":children});
                        mirror::set_state(&doc, &expected)?;
                        assert_eq!(
                            schema::from_loro(&doc.get_map("root").get_deep_value())?,
                            expected,
                            "{order:?} minus {deleted:?}"
                        );
                        for (index, id) in retained.iter().enumerate() {
                            assert_eq!(
                                Some(&schema::map_at(list.get(index), "retained")?.id()),
                                original.get(**id)
                            );
                        }
                    }
                }
            }
        }
    }
    Ok(())
}
