use super::*;
use lexical_rich_nodes::link::{AutoLinkNode, LinkNode};

#[test]
fn inherited_link_fields_remain_readable_from_live_and_retired_raw_records() -> Result<()> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<LinkNode>()
        .node::<AutoLinkNode>()
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let key = tx
        .create(AutoLinkNode {
            link: LinkNode {
                url: "https://example.com".into(),
                target: Some("_blank".into()),
                rel: Some("noopener".into()),
                title: Some("example".into()),
            },
            is_unlinked: false,
        })?
        .key();
    let receiver = json!({"$node": key.to_string(), "ver":1});
    assert_eq!(
        get(tx.node_or_err(key)?, &receiver, "__url")?,
        "https://example.com"
    );
    assert_eq!(get(tx.node_or_err(key)?, &receiver, "__target")?, "_blank");
    tx.flush()?;
    assert!(!tx.contains(key));
    let record = tx.retired_record(key).expect("retired auto link");
    assert_eq!(get(record, &receiver, "__url")?, "https://example.com");
    assert_eq!(get(record, &receiver, "__rel")?, "noopener");
    assert_eq!(get(record, &receiver, "__title")?, "example");
    Ok(())
}
