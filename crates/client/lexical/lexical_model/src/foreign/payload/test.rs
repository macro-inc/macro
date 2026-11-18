use super::*;

#[cfg(feature = "bench-counters")]
#[test]
fn payload_validation_work_stays_flat_for_local_edits() -> Result<(), Error> {
    struct Hooks;
    impl ForeignHooks for Hooks {}
    for foreign in [false, true] {
        let mut counts = Vec::new();
        for size in [10, 10_000] {
            let builder = Editor::builder(EditorMode::Headless);
            let builder = if foreign {
                builder.foreign_node(ForeignNodeType {
                    type_name: "runtime-paragraph".into(),
                    class_name: "RuntimeParagraph".into(),
                    kind: NodeKind::Element,
                    extends: Some("paragraph"),
                    required_state: vec![],
                    hooks: Arc::new(Hooks),
                })
            } else {
                builder
            };
            let mut editor = builder.build().expect("registry");
            let (text, _) = editor.update(|tx| {
                let mut paragraphs = Vec::new();
                for _ in 0..size {
                    paragraphs.push(if foreign {
                        tx.create_foreign("runtime-paragraph", SerializedNode::new())?
                    } else {
                        tx.create(Paragraph {})?.key()
                    });
                }
                let text = tx.create_text("a")?;
                tx.append(paragraphs[0], &[text.key()])?;
                tx.append(NodeKey::ROOT, &paragraphs)?;
                Ok(text)
            })?;
            let (_, commit) = editor.update(|tx| {
                tx.text(text.key())?.set_text_content("ab")?;
                Ok(())
            })?;
            counts.push(commit.work.foreign_payloads_checked);
            let (_, rebuilt) = editor.update(|tx| {
                tx.request_full_reconcile();
                Ok(())
            })?;
            assert_eq!(
                rebuilt.work.foreign_payloads_checked,
                if foreign { size * 2 } else { 0 }
            );
        }
        assert_eq!(counts[0], counts[1]);
        if foreign {
            assert!(counts[0] > 0 && counts[0] <= 2);
        } else {
            assert_eq!(counts, [0, 0]);
        }
    }
    Ok(())
}
