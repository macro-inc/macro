use super::*;
use std::{borrow::Cow, cell::RefCell};
thread_local! { static LOG: RefCell<Vec<&'static str>> = const { RefCell::new(Vec::new()) }; }
fn log_text(_: &mut Transaction<'_>, _: Id<Text>) -> Result<(), Error> {
    LOG.with(|log| log.borrow_mut().push("text"));
    Ok(())
}
fn log_custom(_: &mut Transaction<'_>, _: Id<CustomText>) -> Result<(), Error> {
    LOG.with(|log| log.borrow_mut().push("custom"));
    Ok(())
}
fn log_static(_: &mut Transaction<'_>, _: Id<CustomText>) -> Result<(), Error> {
    LOG.with(|log| log.borrow_mut().push("static"));
    Ok(())
}
fn log_each(_: &mut Transaction<'_>, _: NodeKey) -> Result<(), Error> {
    LOG.with(|log| log.borrow_mut().push("each"));
    Ok(())
}
#[derive(Clone, Default, Debug, PartialEq, Serialize, Deserialize)]
struct CustomText {
    label: String,
}
impl NodeType for CustomText {
    const TYPE: &'static str = "custom-text";
    type Kind = TextKind;
    impl_default_node!();
    fn static_transform() -> Option<TransformFn<Self>> {
        Some(log_static)
    }
    fn after_clone(&self) -> Option<Self> {
        Some(Self {
            label: format!("{} cloned", self.label),
        })
    }
}
impl TextNode for CustomText {
    text_node_base!();
    fn coerce_text_content<'a>(
        &self,
        _: TextView<'_>,
        value: &'a str,
    ) -> Result<Cow<'a, str>, Error> {
        Ok(Cow::Owned(value.to_uppercase()))
    }
    fn coerce_format(&self, _: TextView<'_>, _: TextFormat) -> Result<Option<TextFormat>, Error> {
        Ok(Some(TextFormat::BOLD))
    }
    fn selection_transform(tx: &mut Transaction<'_>, this: Id<Self>) -> Result<(), Error> {
        LOG.with(|log| log.borrow_mut().push("selection"));
        assert!(tx.previous_selection().is_none());
        assert!(tx.is_text(this));
        Ok(())
    }
    fn json_version(&self) -> u32 {
        7
    }
}
#[derive(Clone, Default, Debug, PartialEq, Serialize, Deserialize)]
struct CustomDecorator {
    value: String,
}
impl NodeType for CustomDecorator {
    const TYPE: &'static str = "custom-decorator";
    type Kind = DecoratorKind;
    impl_default_node!();
}
impl DecoratorNode for CustomDecorator {
    decorator_node_base!();
    fn text_content<'a>(&self, _: NodeView<'a>) -> Cow<'a, str> {
        Cow::Owned(self.value.clone())
    }
    fn is_inline(&self, _: NodeView<'_>) -> bool {
        true
    }
    fn is_isolated(&self, _: NodeView<'_>) -> bool {
        true
    }
    fn is_keyboard_selectable(&self, _: NodeView<'_>) -> bool {
        false
    }
    fn reset_on_copy(tx: &mut Transaction<'_>, this: Id<Self>, _: NodeKey) -> Result<(), Error> {
        tx.update_node::<Self>(this, |value| value.value = "copy".into())
    }
}
#[derive(Clone, Default, Debug, PartialEq, Serialize, Deserialize)]
struct CustomBreak {}
impl NodeType for CustomBreak {
    const TYPE: &'static str = "custom-break";
    type Kind = LineBreakKind;
    impl_default_node!();
}
impl LineBreakNode for CustomBreak {
    line_break_node_base!();
}

#[test]
fn replacements_keep_typed_ancestry_and_transform_order() -> Result<(), Error> {
    LOG.with(|log| log.borrow_mut().clear());
    let mut editor = Editor::builder(EditorMode::Headless)
        .replace::<Text, CustomText>(|_| CustomText {
            label: "replacement".into(),
        })
        .transform::<Text>(log_text)
        .transform::<CustomText>(log_custom)
        .transform_each(log_each, TransformScope::Types(&["custom-text"]))
        .build()
        .expect("builder");
    let ((p, text), commit) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("lowercase")?;
        assert!(tx.get::<CustomText>(text).is_some());
        assert_eq!(tx.text_content(text), "LOWERCASE");
        assert_eq!(text.upcast().key(), text.key());
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok((p, text))
    })?;
    LOG.with(|log| assert_eq!(*log.borrow(), vec!["static", "custom", "each", "text"]));
    assert_eq!(
        commit.mutations_of::<Text>().collect::<Vec<_>>(),
        vec![(text.key(), Mutation::Created)]
    );
    assert_eq!(
        commit.next.view().children(p).collect::<Vec<_>>(),
        vec![text.key()]
    );
    let original = editor.registry().index_of::<Text>().expect("text");
    let replacement = editor.registry().index_of::<CustomText>().expect("custom");
    assert_eq!(
        editor.registry().resolve_replacements(original),
        Some(replacement)
    );
    let original_data = editor
        .state()
        .view()
        .get::<CustomText>(text)
        .expect("custom")
        .clone();
    editor.update(|tx| {
        tx.update_node::<CustomText>(text, |node| node.label.push_str(" updated"))?;
        assert_eq!(
            tx.get::<CustomText>(text).expect("custom").label,
            "replacement cloned updated"
        );
        Ok(())
    })?;
    assert_eq!(original_data.label, "replacement");
    Ok(())
}
#[test]
fn exact_and_resolved_creation_and_full_type_metadata() -> Result<(), Error> {
    assert_eq!(Root::class_name(), "RootNode");
    assert_eq!(Text::class_name(), "TextNode");
    assert!(CustomText::static_transform().is_some());
    assert!(CustomText::default_node().is_some());
    assert!(CustomText::flag_probe().is_some());
    assert_eq!(
        CustomText::import_json(
            serde_json::json!({"label":"decoded"})
                .as_object()
                .expect("object")
        )?
        .label,
        "decoded"
    );
    let shared = SharedKeyCounter::new();
    let host = ViewHost {
        engine: ViewEngine::Firefox,
        os: ViewOs::Android,
    };
    let mut editor = EditorBuilder::new(EditorMode::ViewAttached)
        .key_source(KeySource::Shared(shared.clone()))
        .view_host(host)
        .replace::<Text, CustomText>(|_| CustomText::default())
        .build()
        .expect("builder");
    assert_eq!(editor.mode(), EditorMode::ViewAttached);
    let registry = editor.registry();
    assert!(registry.has::<CustomText>());
    assert_eq!(registry.get_or_err("text")?.index.get(), 1);
    let index = registry.index_of::<CustomText>().expect("custom");
    assert_eq!(
        registry.node(index).expect("entry").type_name,
        "custom-text"
    );
    assert_eq!(
        registry.type_table()[usize::from(index.get())].kind,
        NodeKind::Text
    );
    assert!(matches!(
        registry.get_or_err("missing"),
        Err(Error::UnregisteredNodeType(_))
    ));
    let mut tx = editor.transaction();
    assert_eq!(tx.view_host(), host);
    let exact = tx.create_exact(Text::default())?;
    let resolved = tx.create_resolved::<Text>()?;
    let based = tx.create_with(Text::default(), BaseData::Text(TextData::new("base")))?;
    assert_eq!(tx.type_name(exact)?, "text");
    assert_eq!(tx.type_name(resolved)?, "custom-text");
    assert_eq!(tx.text_content(based), "base");
    assert!(matches!(
        tx.create_with(Text::default(), BaseData::Decorator),
        Err(Error::BaseKindMismatch)
    ));
    assert!(matches!(
        tx.get_mut::<Paragraph>(exact),
        Err(Error::NodeTypeMismatch(_))
    ));
    assert!(matches!(
        tx.get_mut::<Text>(resolved),
        Err(Error::NoMutableUpcast(_))
    ));
    tx.mark_dirty(based)?;
    assert!(tx.is_dirty_leaf(based));
    let other = Editor::builder(EditorMode::Headless)
        .key_source(KeySource::Shared(shared))
        .build()
        .expect("other");
    assert!(other.state().is_empty_state());
    Ok(())
}
#[test]
fn custom_text_selection_coercion_and_decorator_copy_dispatch() -> Result<(), Error> {
    LOG.with(|log| log.borrow_mut().clear());
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<CustomText>()
        .node::<CustomDecorator>()
        .node::<CustomBreak>()
        .build()
        .expect("builder");
    editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create(CustomText::default())?;
        let deco = tx.create(CustomDecorator {
            value: "label".into(),
        })?;
        let line = tx.create(CustomBreak::default())?;
        tx.text(text)?
            .set_text_content("small")?
            .set_format(TextFormat::ITALIC)?;
        tx.append(p, &[text.key(), deco.key(), line.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        assert_eq!(tx.text_content(text), "SMALL");
        assert_eq!(tx.view().text(text).expect("text").format, TextFormat::BOLD);
        assert_eq!(
            tx.export_json(text)?.get("version"),
            Some(&serde_json::json!(7))
        );
        assert_eq!(tx.text_content(deco), "label");
        assert!(tx.is_inline(deco));
        assert!(tx.is_isolated(deco));
        assert!(!tx.is_keyboard_selectable(deco));
        assert!(tx.is_decorator(deco));
        assert_eq!(tx.text_content(line), "\n");
        let copy = tx.copy_node(deco, false)?;
        assert_eq!(tx.text_content(copy), "copy");
        tx.reset_on_copy(copy, deco.key())?;
        assert_eq!(tx.get::<CustomDecorator>(copy).expect("deco").value, "copy");
        tx.text(text)?.select(None, None)?;
        tx.flush()?;
        Ok(())
    })?;
    LOG.with(|log| assert_eq!(*log.borrow(), vec!["selection", "static"]));
    Ok(())
}

#[derive(Clone, Default, Debug, PartialEq, Serialize, Deserialize)]
struct OrderedImport {}
impl NodeType for OrderedImport {
    const TYPE: &'static str = "ordered-import";
    type Kind = ElementKind;
    impl_default_node!();
}
impl ElementNode for OrderedImport {
    element_node_base!();
    fn set_indent(tx: &mut Transaction<'_>, this: Id<Self>, indent: u32) -> Result<(), Error> {
        assert_eq!(
            tx.view().element(this).expect("element").format,
            ElementFormat::Center
        );
        tx.set_indent_base(this.key(), indent)
    }
}
#[test]
fn element_import_sets_alignment_before_virtual_indent() -> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<OrderedImport>()
        .build()
        .expect("builder");
    let mut tx = editor.transaction();
    let json = serde_json::json!({"type":"ordered-import","format":"center","indent":3});
    let node = tx.import_node(json.as_object().expect("object"))?;
    assert_eq!(tx.indent(node), 3);
    Ok(())
}

#[derive(Clone, Default, Debug, PartialEq, Serialize, Deserialize)]
struct MovingFocus {
    move_focus: bool,
}
impl NodeType for MovingFocus {
    const TYPE: &'static str = "moving-focus";
    type Kind = TextKind;
    impl_default_node!();
}
impl TextNode for MovingFocus {
    text_node_base!();
    fn selection_transform(tx: &mut Transaction<'_>, this: Id<Self>) -> Result<(), Error> {
        if tx.get::<Self>(this).expect("node").move_focus {
            let old_focus = tx
                .range_at(SelectionSlot::Active)
                .expect("range")
                .focus
                .key();
            let last = tx.next_sibling(old_focus).expect("last");
            let mut range = tx.range_at(SelectionSlot::Active).expect("range").clone();
            range.focus = Point::text(last, Utf16Offset(0));
            tx.set_selection(Some(Selection::Range(range)))?;
            tx.remove(old_focus, true)?;
            LOG.with(|log| log.borrow_mut().push("anchor"));
        } else {
            LOG.with(|log| log.borrow_mut().push("focus"));
        }
        Ok(())
    }
}
#[test]
fn selection_hooks_read_focus_after_anchor_moves_it() -> Result<(), Error> {
    LOG.with(|log| log.borrow_mut().clear());
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<MovingFocus>()
        .build()
        .expect("builder");
    editor.update(|tx| {
        let p = tx.create(Paragraph::default())?;
        let a = tx.create(MovingFocus { move_focus: true })?;
        let b = tx.create(MovingFocus { move_focus: false })?;
        let c = tx.create(MovingFocus { move_focus: false })?;
        tx.append(p, &[a.key(), b.key(), c.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.set_selection(Some(Selection::Range(RangeSelection {
            anchor: Point::text(a, Utf16Offset(0)),
            focus: Point::text(b, Utf16Offset(0)),
            format: TextFormat::empty(),
            style: "".into(),
        })))
    })?;
    LOG.with(|log| assert_eq!(*log.borrow(), vec!["anchor", "focus"]));
    Ok(())
}
