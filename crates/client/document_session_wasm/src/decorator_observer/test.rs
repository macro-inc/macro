use super::*;
use crate::{output, BoundaryError};
use document_session::{SessionOutput, ViewEffect};
use lexical_model::{
    DecoratorRenderChange, DecoratorRenderPolicy, DecoratorRenderSignature, DiffOp, KeyParts,
    NodeKey,
};

fn patch(policy: Option<DecoratorRenderPolicy>) -> Diff {
    Diff {
        generation: 7,
        full_reconcile: false,
        view_text_matches: None,
        ops: vec![],
        decorator_renders: vec![DecoratorRenderChange {
            key: NodeKey::from_parts(KeyParts {
                generation: 7,
                index: 3,
            }),
            policy,
        }],
    }
}
fn signature(value: &str) -> Option<DecoratorRenderPolicy> {
    Some(DecoratorRenderPolicy::Signature(
        DecoratorRenderSignature::new(value.into()),
    ))
}
fn encode(observer: &mut DecoratorObserver, patches: Vec<Diff>) -> Vec<u32> {
    let output = SessionOutput {
        view: patches.into_iter().map(ViewEffect::Diff).collect(),
        ..Default::default()
    };
    let mut bytes = vec![];
    output::encode_observed(&output, false, &mut bytes, None, None, observer).unwrap();
    let words: Vec<_> = bytes
        .chunks_exact(4)
        .map(|b| u32::from_le_bytes(b.try_into().unwrap()))
        .collect();
    let count = words[3] as usize;
    words[6..6 + count].to_vec()
}
#[test]
fn coalesced_and_untransferred_signatures_compare_only_last_exposed_value() {
    let mut observer = DecoratorObserver::default();
    assert_eq!(
        encode(&mut observer, vec![patch(signature("A"))])[5..],
        [12, 3, 0, 0]
    );
    observer.expose().unwrap();
    assert_eq!(
        encode(
            &mut observer,
            vec![patch(signature("B")), patch(signature("A"))]
        )[4],
        0
    );
    observer.expose().unwrap();
    assert_eq!(
        encode(&mut observer, vec![patch(signature("B"))])[5..],
        [12, 3, 1, 0]
    );
    // Replacing an untransferred B packet cannot observe B.
    assert_eq!(encode(&mut observer, vec![patch(signature("A"))])[4], 0);
    observer.expose().unwrap();
    assert_eq!(
        encode(&mut observer, vec![patch(signature("B"))])[5..],
        [12, 3, 1, 0]
    );
    observer.expose().unwrap();
    assert_eq!(
        encode(&mut observer, vec![patch(signature("A"))])[5..],
        [12, 3, 2, 0]
    );
}

#[test]
fn detach_keeps_io_live_without_observation_until_initialize_is_transferred() {
    use document_session::InitialView;
    use lexical_model::{Editor, EditorMode};
    let mut observer = DecoratorObserver::default();
    encode(&mut observer, vec![patch(signature("A"))]);
    observer.expose().unwrap();
    let key = patch(None).decorator_renders[0].key;
    observer.retire();
    let output = SessionOutput {
        view: vec![ViewEffect::Diff(patch(signature("B")))],
        io: vec![doc_sync_core::IoEffect::SocketPing {
            conn: doc_sync_core::ConnId(17),
        }],
        ..Default::default()
    };
    let mut bytes = Vec::new();
    let flags =
        output::encode_observed(&output, false, &mut bytes, None, None, &mut observer).unwrap();
    assert_eq!(flags & 3, 3, "view/control output and I/O still drain");
    assert!(!bytes.is_empty());
    observer.expose().unwrap();
    assert!(observer.pending.is_none());
    assert!(observer.retired);
    assert_eq!(observer.view.exposed_revision(key), None);
    let editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let initialize = SessionOutput {
        view: vec![ViewEffect::Initialize(InitialView::Editor {
            diff: patch(signature("A")),
            state: editor.state().to_json().unwrap(),
        })],
        ..Default::default()
    };
    output::encode_observed(&initialize, false, &mut bytes, None, None, &mut observer).unwrap();
    observer.expose().unwrap();
    assert!(
        observer.retired,
        "queued initialization while detached cannot remount"
    );
    observer
        .with_initialization(|observer| {
            output::encode_observed(&initialize, false, &mut bytes, None, None, observer)
        })
        .unwrap();
    assert!(observer.retired, "encoding alone is not exposure");
    assert_eq!(observer.view.exposed_revision(key), None);
    // An untransferred initialization replaced by a control packet cannot remount.
    assert_eq!(encode(&mut observer, vec![patch(signature("B"))])[4], 0);
    observer.expose().unwrap();
    assert!(observer.retired);
    observer
        .with_initialization(|observer| {
            output::encode_observed(&initialize, false, &mut bytes, None, None, observer)
        })
        .unwrap();
    observer.expose().unwrap();
    assert!(!observer.retired);
    assert_eq!(observer.view.exposed_revision(key), Some(0));
    assert_eq!(
        encode(&mut observer, vec![patch(signature("B"))])[5..],
        [12, 3, 1, 0]
    );
}
#[test]
fn eager_precision_removal_generation_and_remount_have_distinct_lifetimes() {
    let mut observer = DecoratorObserver::default();
    let revision = (1u64 << 53) + 9;
    assert_eq!(
        encode(
            &mut observer,
            vec![patch(Some(DecoratorRenderPolicy::Eager(revision)))]
        )[5..],
        [12, 3, 9, 2097152]
    );
    observer.expose().unwrap();
    assert_eq!(
        encode(
            &mut observer,
            vec![patch(Some(DecoratorRenderPolicy::Eager(revision)))]
        )[4],
        0
    );
    observer.expose().unwrap();
    encode(&mut observer, vec![patch(None)]);
    observer.expose().unwrap();
    assert_eq!(
        observer
            .view
            .exposed_revision(patch(None).decorator_renders[0].key),
        None
    );
    encode(&mut observer, vec![patch(signature("A"))]);
    observer.expose().unwrap();
    let mut changed = patch(signature("B"));
    let observation = observer.prepare(&mut changed, true).unwrap();
    assert!(matches!(
        changed.ops.last(),
        Some(DiffOp::SetDecoratorRevision { revision: 0, .. })
    ));
    observer.stage(observation);
    observer.expose().unwrap();
    let mut next = patch(signature("C"));
    next.generation = 8;
    next.decorator_renders[0].key = NodeKey::from_parts(KeyParts {
        generation: 8,
        index: 3,
    });
    let observation = observer.prepare(&mut next, false).unwrap();
    observer.stage(observation);
    observer.expose().unwrap();
    assert_eq!(
        observer
            .view
            .exposed_revision(patch(None).decorator_renders[0].key),
        None
    );
    assert_eq!(
        observer
            .view
            .exposed_revision(next.decorator_renders[0].key),
        Some(0)
    );
}
#[test]
fn failure_preserves_exposed_signature_and_checked_revision() {
    let mut observer = DecoratorObserver::default();
    encode(&mut observer, vec![patch(signature("A"))]);
    observer.expose().unwrap();
    let key = patch(None).decorator_renders[0].key;
    let mut changed = patch(Some(DecoratorRenderPolicy::Eager(1)));
    assert!(matches!(
        observer.prepare(&mut changed, false),
        Err(BoundaryError::Model(lexical_model::Error::Invariant(
            "decorator render policy changed"
        )))
    ));
    assert!(changed.ops.is_empty());
    assert_eq!(observer.view.exposed_revision(key), Some(0));
}

#[test]
fn real_machine_transfer_initialize_and_detach_own_distinct_observation_boundaries() {
    use crate::{bytes, generated, machine::Machine, wire};
    let config = wire::SessionConfigMsg {
        doc: "decorator-observation-fixture".into(),
        session: "00000000-0000-0000-0000-000000000001".into(),
        user: "fixture-user".into(),
        peers: vec![7, 8, 9],
        access: wire::Access::Edit,
        transport: wire::Transport::None,
        durable: false,
        chatter: false,
        headless: false,
        view_engine: 1,
        view_os: 0,
        token: String::new(),
        traceparent: String::new(),
        coalesce: 25,
        snapshot_interval: 0,
        observed: vec![],
    };
    let mut machine = Machine::create(
        generated::ABI_MAJOR,
        &bytes(&config).unwrap(),
        0.0,
        0.0,
        true,
    )
    .unwrap();
    let output = SessionOutput {
        view: vec![ViewEffect::Diff(patch(signature("A")))],
        ..Default::default()
    };
    output::encode_observed(
        &output,
        false,
        &mut machine.output,
        None,
        None,
        &mut machine.decorator_observer,
    )
    .unwrap();
    assert!(machine
        .decorator_observer
        .view
        .exposed_revision(patch(None).decorator_renders[0].key)
        .is_none());
    assert!(matches!(
        machine.initialize_view(),
        Err(BoundaryError::Invalid(
            "initialize before pending output transfer"
        ))
    ));
    assert!(!machine.take_output().unwrap().is_empty());
    assert_eq!(
        machine
            .decorator_observer
            .view
            .exposed_revision(patch(None).decorator_renders[0].key),
        Some(0)
    );
    assert!(!machine.initialize_view().unwrap().is_empty());
    assert!(machine
        .decorator_observer
        .view
        .exposed_revision(patch(None).decorator_renders[0].key)
        .is_none());
    assert!(machine.decorator_observer.pending.is_none());
    encode(&mut machine.decorator_observer, vec![patch(signature("B"))]);
    machine.decorator_observer.expose().unwrap();
    assert_eq!(
        machine
            .decorator_observer
            .view
            .exposed_revision(patch(None).decorator_renders[0].key),
        Some(0)
    );
    machine.decorator_observer.retire();
    assert!(machine
        .decorator_observer
        .view
        .exposed_revision(patch(None).decorator_renders[0].key)
        .is_none());
    assert!(machine.decorator_observer.pending.is_none());
}

#[test]
fn relative_full_comparison_preserves_prior_removal_but_initialize_replaces_it() {
    use document_session::InitialView;
    use lexical_model::{Editor, EditorMode};
    let mut observer = DecoratorObserver::default();
    encode(&mut observer, vec![patch(signature("A"))]);
    observer.expose().unwrap();
    let mut removal = patch(None);
    let key = removal.decorator_renders[0].key;
    removal.ops.push(DiffOp::Remove {
        key,
        subtree_root: true,
    });
    let mut full = patch(None);
    full.full_reconcile = true;
    full.decorator_renders.clear();
    let words = encode(&mut observer, vec![removal.clone(), full]);
    assert_eq!(
        &words[5..],
        &[1, 3, 1],
        "relative full comparison must keep earlier removal"
    );
    observer.expose().unwrap();
    assert_eq!(
        observer
            .view
            .exposed_revision(patch(None).decorator_renders[0].key),
        None
    );
    encode(&mut observer, vec![patch(signature("A"))]);
    observer.expose().unwrap();
    let editor = Editor::builder(EditorMode::Headless)
        .node::<macro_document_model::nodes::EquationNode>()
        .build()
        .unwrap();
    let type_index = editor
        .registry()
        .index_of::<macro_document_model::nodes::EquationNode>()
        .unwrap();
    let mut initialized = patch(signature("B"));
    initialized.ops.push(DiffOp::CreateDecorator {
        key,
        type_index,
        props: Default::default(),
    });
    let output = SessionOutput {
        view: vec![
            ViewEffect::Diff(removal),
            ViewEffect::Initialize(InitialView::Editor {
                diff: initialized,
                state: editor.state().to_json().unwrap(),
            }),
        ],
        ..Default::default()
    };
    let mut bytes = vec![];
    output::encode_observed(&output, false, &mut bytes, None, None, &mut observer).unwrap();
    let words: Vec<_> = bytes
        .chunks_exact(4)
        .map(|b| u32::from_le_bytes(b.try_into().unwrap()))
        .collect();
    assert_eq!(
        &words[11..20],
        &[4, 3, u32::from(type_index.get()), 0, 0, 12, 3, 0, 0]
    );
    observer.expose().unwrap();
    assert_eq!(observer.view.exposed_revision(key), Some(0));
}

#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(transparent)]
struct ObservedEquation(macro_document_model::nodes::EquationNode);
impl lexical_model::NodeType for ObservedEquation {
    const TYPE: &'static str = "checklist-observed-equation";
    type Kind = lexical_model::DecoratorKind;
    lexical_model::impl_default_node!();
}
impl lexical_model::DecoratorNode for ObservedEquation {
    type Parent = macro_document_model::nodes::EquationNode;
    fn as_parent(&self) -> &Self::Parent {
        &self.0
    }
    fn as_parent_mut(&mut self) -> Option<&mut Self::Parent> {
        Some(&mut self.0)
    }
    fn render_signature(&self) -> Result<Option<DecoratorRenderSignature>, lexical_model::Error> {
        Ok(Some(DecoratorRenderSignature::new(serde_json::to_string(
            &self.0.equation,
        )?)))
    }
}

#[test]
fn injected_append_failure_preserves_the_new_packet_observation_and_plan_receipts(
) -> Result<(), BoundaryError> {
    use crate::{bytes, generated, machine, wire};
    use doc_sync_core::*;
    use document_session::{
        application_editor_config, DocumentSession, EditorConfig, SurfaceConfig,
    };
    use lexical_model::{Input, TagSet, ViewSelection};
    use serde_json::json;
    use std::sync::{atomic::AtomicI64, Arc};
    let config = wire::SessionConfigMsg {
        doc: "append-failure-fixture".into(),
        session: "00000000-0000-0000-0000-000000000001".into(),
        user: "fixture-user".into(),
        peers: vec![71, 72, 73],
        access: wire::Access::Edit,
        transport: wire::Transport::None,
        durable: false,
        chatter: false,
        headless: false,
        view_engine: 1,
        view_os: 0,
        token: String::new(),
        traceparent: String::new(),
        coalesce: 25,
        snapshot_interval: 0,
        observed: vec![],
    };
    let mut machine =
        machine::Machine::create_macro(generated::ABI_MAJOR, &bytes(&config)?, 0.0, 0.0)?;
    let (mut session_config, _, view_host) = crate::codec::config(config)?;
    let mut editor_config = application_editor_config(
        EditorConfig {
            view_host,
            ..EditorConfig::default()
        },
        Arc::new(AtomicI64::new(0)),
        macro_document_model::EditorType::MarkdownSync,
    );
    let registered_builder = editor_config.builder.clone();
    editor_config.builder =
        Arc::new(move |mode, peer| registered_builder(mode, peer).node::<ObservedEquation>());
    session_config.surface = SurfaceConfig::Editor(editor_config);
    machine.session = machine::Session::Editor(Box::new(DocumentSession::new(
        session_config,
        crate::codec::now(0.0, 0.0)?,
    )?));
    machine.sync(SyncInput::Start, 0.0, None)?;
    machine.sync(
        SyncInput::Seed {
            kind: SeedKind::Optimistic,
            snapshot: vec![],
        },
        1.0,
        None,
    )?;
    machine.editor(Input::SetState { state: serde_json::from_value(json!({"root":{"type":"root","children":[{"type":"list","listType":"check","tag":"ul","start":1,"children":[{"type":"listitem","value":1,"checked":false,"children":[{"type":"text","text":"Work"}]}]},{"type":"paragraph","children":[{"type":"checklist-observed-equation","equation":"x","inline":true}]}]}}))?, tags:TagSet::default() },2.0)?;
    machine.take_output()?;
    let machine::Session::Editor(session) = &machine.session else {
        panic!("editor")
    };
    let state = session.surface().state();
    let equation = state
        .view()
        .descendants(NodeKey::ROOT)
        .find_map(|(key, _)| state.view().get::<ObservedEquation>(key).map(|_| key))
        .expect("equation");
    let generation = state.max_key().generation();
    let before_revision = machine
        .decorator_observer
        .view
        .exposed_revision(equation)
        .expect("observed decorator");
    let mut facts: serde_json::Value = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../lexical/macro_document_model/src/plugins_group_b/checklist_query/request-example.json"
    )))?;
    facts.as_object_mut().expect("object").remove("listKey");
    facts["factsVersion"] = json!("1");
    let command = macro_document_model::surface::decode_command(
        "group-b.set-checklist-facts",
        &facts.to_string(),
        generation,
        None,
    )?
    .expect("facts");
    machine.editor(
        Input::Command {
            command: command.clone(),
            selection: ViewSelection::KeepModel,
        },
        3.0,
    )?;
    assert_eq!(machine.pending_checklist_output.len(), 1);
    machine.reject_text("invalid DOM text input")?;
    let superseded = machine.output.clone();
    assert!(machine.pending_checklist_output.is_empty());
    let update = macro_document_model::surface::decode_command(
        "group-b.equation",
        &json!({"key":equation.index(),"equation":"y^2"}).to_string(),
        generation,
        None,
    )?
    .expect("update");
    let _injection = crate::telemetry::fail_next_append();
    assert!(matches!(
        machine.editor(
            Input::Command {
                command: update,
                selection: ViewSelection::KeepModel
            },
            4.0
        ),
        Err(BoundaryError::Invalid("injected telemetry append"))
    ));
    assert_ne!(
        machine.output, superseded,
        "append failure keeps the successfully encoded new packet"
    );
    assert_eq!(machine.pending_checklist_output.len(), 1);
    assert_eq!(
        serde_json::to_value(&machine.pending_checklist_output)?[0]["sequence"],
        "1"
    );
    assert_eq!(
        machine.decorator_observer.view.exposed_revision(equation),
        Some(before_revision)
    );
    let encoded = machine.output.clone();
    assert_eq!(machine.take_output()?, encoded);
    assert_eq!(
        machine.decorator_observer.view.exposed_revision(equation),
        Some(before_revision + 1)
    );
    assert!(machine.take_output()?.is_empty());
    machine.editor(
        Input::Command {
            command,
            selection: ViewSelection::KeepModel,
        },
        5.0,
    )?;
    assert!(
        machine.pending_checklist_output.is_empty(),
        "the new packet's exact receipt was acknowledged once"
    );
    Ok(())
}
