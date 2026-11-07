use super::*;
#[test]
fn remote_create_update_splice_and_reorder_preserve_utf16_and_selection() {
    let editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let mut core = EditorCore::new(
        editor,
        CoreConfig {
            history: None,
            editable: false,
            diff: DiffOptions::default(),
            track_text_content: false,
        },
    );
    let output=core.apply(Input::ApplyRemote {changes:vec![
        NodeChange::Create {local:LocalNode(1),json:serde_json::json!({"type":"paragraph","version":1,"format":"","indent":0,"direction":null,"children":[]}).as_object().unwrap().clone()},
        NodeChange::Create {local:LocalNode(2),json:serde_json::json!({"type":"text","version":1,"text":"a😀b","mode":"normal","format":0,"detail":0,"style":""}).as_object().unwrap().clone()},
        NodeChange::Children {parent:NodeTarget::Local(LocalNode(1)),children:vec![NodeTarget::Local(LocalNode(2))]},
        NodeChange::Children {parent:NodeTarget::Key(NodeKey::ROOT),children:vec![NodeTarget::Local(LocalNode(1))]},
        NodeChange::SpliceText {node:NodeTarget::Local(LocalNode(2)),range:Utf16Offset(1)..Utf16Offset(3),insert:"é".into()},
    ],options:UpdateOptions {skip_transforms:true,tags:TagSet::from_tags([UpdateTag::Collaboration])}},HistoryTime(0)).unwrap();
    let text = core.state().view().first_descendant(NodeKey::ROOT).unwrap();
    assert_eq!(core.state().view().text_content(text), "aéb");
    assert!(output.commits[0].tags.contains(&UpdateTag::Collaboration));
    assert!(
        matches!(&output.effects[0],Effect::RemoteNodesCreated(nodes) if nodes.len()==2 && nodes[1].1==text)
    );
    core.apply(Input::ApplyRemote {changes:vec![NodeChange::Update {node:NodeTarget::Key(text),json:serde_json::json!({"type":"text","version":1,"text":"updated","mode":"normal","format":1,"detail":0,"style":""}).as_object().unwrap().clone()}],options:UpdateOptions::default()},HistoryTime(1)).unwrap();
    assert_eq!(core.state().view().text_content(text), "updated");
    core.apply(
        Input::ApplyRemote {
            changes: vec![NodeChange::Remove {
                node: NodeTarget::Key(text),
            }],
            options: UpdateOptions::default(),
        },
        HistoryTime(2),
    )
    .unwrap();
    assert!(!core.state().view().contains(text));
    assert_eq!(core.state().view().children_size(NodeKey::ROOT), 1);
}
#[test]
fn remote_errors_roll_back_prior_edits_and_reject_unknown_or_duplicate_locals() {
    let mut editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let (text, _) = editor
        .update(|tx| {
            let p = tx.create(Paragraph::default())?;
            let t = tx.create_text("a😀b")?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            tx.append(p, &[t.key()])?;
            Ok(t.key())
        })
        .unwrap();
    let mut core = EditorCore::new(
        editor,
        CoreConfig {
            history: None,
            editable: false,
            diff: DiffOptions::default(),
            track_text_content: false,
        },
    );
    let error = core
        .apply(
            Input::ApplyRemote {
                changes: vec![
                    NodeChange::SpliceText {
                        node: NodeTarget::Key(text),
                        range: Utf16Offset(0)..Utf16Offset(1),
                        insert: "z".into(),
                    },
                    NodeChange::SpliceText {
                        node: NodeTarget::Key(text),
                        range: Utf16Offset(2)..Utf16Offset(3),
                        insert: "bad".into(),
                    },
                ],
                options: UpdateOptions::default(),
            },
            HistoryTime(0),
        )
        .unwrap_err();
    assert_eq!(error.error.kind(), "Utf16OffsetSplitsSurrogatePair");
    assert!(error.committed.is_empty());
    assert_eq!(&*core.state().root_text_content(), "a😀b");
    let error = core
        .apply(
            Input::ApplyRemote {
                changes: vec![NodeChange::Remove {
                    node: NodeTarget::Local(LocalNode(8)),
                }],
                options: UpdateOptions::default(),
            },
            HistoryTime(1),
        )
        .unwrap_err();
    assert_eq!(error.error.kind(), "UnknownLocalNode");
    let error = core
        .apply(
            Input::ApplyRemote {
                changes: vec![NodeChange::Children {
                    parent: NodeTarget::Key(NodeKey::ROOT),
                    children: vec![NodeTarget::Key(text), NodeTarget::Key(text)],
                }],
                options: UpdateOptions::default(),
            },
            HistoryTime(2),
        )
        .unwrap_err();
    assert_eq!(error.error.kind(), "DuplicateRemoteChild");
    assert_eq!(&*core.state().root_text_content(), "a😀b");
}

#[derive(Clone, Default, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
struct UppercaseText {}
impl NodeType for UppercaseText {
    const TYPE: &'static str = "uppercase";
    type Kind = TextKind;
    impl_default_node!();
}
impl TextNode for UppercaseText {
    text_node_base!();
    fn coerce_text_content<'a>(
        &self,
        _: TextView<'_>,
        text: &'a str,
    ) -> Result<std::borrow::Cow<'a, str>, Error> {
        Ok(std::borrow::Cow::Owned(text.to_uppercase()))
    }
}
#[test]
fn remote_creation_is_exact_and_raw_updates_bypass_replacements_and_setters() {
    let mut editor = Editor::builder(EditorMode::Headless)
        .replace::<Text, UppercaseText>(|_| UppercaseText {})
        .build()
        .unwrap();
    editor.update(|tx|{
        let p=tx.create(Paragraph::default())?;tx.append(NodeKey::ROOT,&[p.key()])?;
        let text=tx.import_remote_node(serde_json::json!({"type":"text","version":1,"text":"lower","mode":"normal","format":0,"detail":0,"style":""}).as_object().unwrap())?;
        assert!(tx.is::<Text>(text));assert!(!tx.is::<UppercaseText>(text));
        let custom=tx.import_remote_node(serde_json::json!({"type":"uppercase","version":1,"text":"raw","mode":"normal","format":0,"detail":0,"style":""}).as_object().unwrap())?;
        assert_eq!(tx.text_content(custom),"raw");
        tx.text(custom)?.set_text_content("virtual")?;assert_eq!(tx.text_content(custom),"VIRTUAL");
        tx.apply_remote_fields(custom,serde_json::json!({"type":"uppercase","version":1,"text":"raw again","mode":"normal","format":0,"detail":0,"style":""}).as_object().unwrap())?;
        assert_eq!(tx.text_content(custom),"raw again");
        tx.append(p,&[text,custom])
    }).unwrap();
}
