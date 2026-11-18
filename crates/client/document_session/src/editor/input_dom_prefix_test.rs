use super::*;

struct Prefix(bool);
impl Plugin for Prefix {
    fn name(&self) -> &'static str {
        "existing-prevent-prefix"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &[CommandRegistration {
            command: CommandKind::KeyDown,
            priority: CommandPriority::Critical,
            placement: Placement::Before,
        }]
    }
    fn handle(&self, tx: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
        if self.0 {
            tx.prevent_default();
        }
        tx.dispatch(&Command::FormatText(TextFormatType::Bold))
    }
}
struct NestedFailure;
impl Plugin for NestedFailure {
    fn name(&self) -> &'static str {
        "nested-format-error"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &[CommandRegistration {
            command: CommandKind::FormatText,
            priority: CommandPriority::Critical,
            placement: Placement::Before,
        }]
    }
    fn handle(&self, _: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
        Err(Error::Invariant("injected nested Format failure"))
    }
}

#[test]
fn existing_prevent_prefix_survives_nested_error_without_a_commit() {
    exercise(true);
}
#[test]
fn no_prefix_error_does_not_invent_prevention() {
    exercise(false);
}
fn exercise(prevent: bool) {
    let now = Now {
        mono: doc_sync_core::Millis(0),
        wall: doc_sync_core::UnixMillis(0),
    };
    let doc = lexical_loro::new_doc(17).unwrap();
    let source = default_editor_builder(EditorMode::Headless, 17)
        .build()
        .unwrap();
    LoroProjection::initialize(&doc, source.state(), &PLAIN, 0).unwrap();
    let mut surface = EditorSurface::new(
        EditorConfig {
            builder: Arc::new(move |mode, peer| {
                default_editor_builder(mode, peer)
                    .plugin(Prefix(prevent))
                    .plugin(NestedFailure)
            }),
            ..EditorConfig::default()
        },
        17,
        now,
    )
    .unwrap();
    let mut view = Vec::new();
    surface.init(&doc, now, Access::Edit, &mut view).unwrap();
    view.clear();
    let before = surface.state().to_json_string().unwrap();
    let version = doc.oplog_vv();
    let changed = surface
        .apply(
            &doc,
            Input::KeyDown {
                event: KeyEvent {
                    key: "e".into(),
                    ctrl: true,
                    ..KeyEvent::default()
                },
                routed: None,
                routed_prevent_default: false,
                selection: ViewSelection::KeepModel,
            },
            now,
            Access::Edit,
            &mut view,
        )
        .unwrap();
    assert!(!changed);
    assert_eq!(surface.state().to_json_string().unwrap(), before);
    assert_eq!(doc.oplog_vv(), version);
    assert!(view.iter().any(|effect| matches!(
        effect,
        ViewEffect::Error(SessionError::Model(Error::Invariant(
            "injected nested Format failure"
        )))
    )));
    assert!(
        !view
            .iter()
            .any(|effect| matches!(effect, ViewEffect::Diff(_)))
    );
    assert_eq!(
        view.iter()
            .filter(|effect| matches!(effect, ViewEffect::Editor(Effect::PreventDefault)))
            .count(),
        usize::from(prevent)
    );
    // A different actual next input cannot inherit the failed key's prevention.
    view.clear();
    surface
        .apply(
            &doc,
            Input::Command {
                command: Command::FormatElement(ElementFormat::Center),
                selection: ViewSelection::KeepModel,
            },
            now,
            Access::Edit,
            &mut view,
        )
        .unwrap();
    assert!(
        !view
            .iter()
            .any(|effect| matches!(effect, ViewEffect::Editor(Effect::PreventDefault)))
    );
}
