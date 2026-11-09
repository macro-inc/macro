use super::*;
use doc_sync_core::*;

fn fixture(
    ready: bool,
    access: Access,
    builder: Arc<dyn Fn(EditorMode, u64) -> EditorBuilder + Send + Sync>,
) -> Result<DocumentSession<EditorSurface>, Box<dyn std::error::Error>> {
    let now = Now {
        mono: Millis(0),
        wall: UnixMillis(0),
    };
    let mut session = DocumentSession::new(
        SessionConfig {
            sync: SyncConfig {
                doc: "prepared-session-test".parse()?,
                session: SessionId(uuid_value::Uuid::from_u128(2)),
                user: UserKey("fixture-user".into()),
                transport: TransportKind::None,
                persistence: Persistence::Memory,
                access,
                initial_token: Some(SyncToken::new("fixture-token".into())),
                traceparent: None,
                timeouts: Timeouts::default(),
                heartbeat: HeartbeatPolicy::default(),
                backoff: BackoffPolicy::default(),
                converge: ConvergePolicy::default(),
                wal: WalPolicy::default(),
                snapshot_interval: None,
                presence: PresencePolicy {
                    timeout: WallDuration(10_000),
                    refresh: None,
                    user: PresenceUser {
                        user_id: None,
                        color: PaletteColor::Blue,
                    },
                    key: PresenceKeyMode::Peer,
                },
                chatter: false,
                reset_budget: ResetBudget::default(),
            },
            peer_ids: vec![20, 21, 22, 23],
            peer_range: PeerRange::User,
            surface: SurfaceConfig::Editor(EditorConfig {
                builder,
                mode: EditorMode::ViewAttached,
                ..EditorConfig::default()
            }),
        },
        now,
    )?;
    if ready {
        session.handle(now, SessionInput::Sync(SyncInput::Start));
        session.handle(
            now,
            SessionInput::Sync(SyncInput::Seed {
                kind: SeedKind::Optimistic,
                snapshot: vec![],
            }),
        );
    }
    Ok(session)
}

fn edited_main(
    session: &mut DocumentSession<EditorSurface>,
) -> Result<PreparedUpdate, Box<dyn std::error::Error>> {
    let pending = session.suspend_staged_update();
    let (pending, edited) = session.with_staged_update(pending, |tx| -> Result<(), Error> {
        let p = tx.create(Paragraph::default())?;
        let t = tx.create_text("prepared main")?;
        tx.append(p, &[t.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        tx.select_end(t)?;
        tx.add_tag(UpdateTag::Paste);
        tx.flush()
    })?;
    edited?;
    Ok(session.prepare_staged_update(pending)?)
}

#[test]
fn ordinary_policy_refusal_preserves_the_capsule_and_publication_consumes_once()
-> Result<(), Box<dyn std::error::Error>> {
    let now = Now {
        mono: Millis(1),
        wall: UnixMillis(1),
    };
    for (ready, access, accepted) in [
        (false, Access::Edit, false),
        (true, Access::Read, false),
        (true, Access::Edit, true),
    ] {
        let mut session = fixture(ready, access, Arc::new(default_editor_builder))?;
        let version = session.version();
        let before = session.surface().state().to_json()?;
        let prepared = edited_main(&mut session)?;
        let expected = prepared.next().to_json()?;
        let receipt = prepared.receipt();
        assert_eq!(session.surface().state().to_json()?, before);
        assert_eq!(session.version(), version);
        assert!(!session.surface().history().can_undo);
        assert!(receipt.main_publication().is_none());
        let admission = PreparedAdmission::new(prepared);
        let out = session.handle(now, admission.input());
        assert_eq!(
            out.view
                .iter()
                .any(|effect| matches!(effect, ViewEffect::Error(_))),
            !accepted
        );
        assert_eq!(admission.was_adopted()?, accepted);
        assert_eq!(admission.main_publication().is_some(), accepted);
        if accepted {
            assert_eq!(
                session.surface().state().root_text_content().as_ref(),
                "prepared main"
            );
            assert!(session.surface().history().can_undo);
            assert!(admission.recover_unadopted()?.is_none());
            let out = session.handle(now, admission.input());
            assert!(
                out.view
                    .iter()
                    .any(|effect| matches!(effect, ViewEffect::Error(_)))
            );
            session.handle(now, SessionInput::Editor(Input::Undo));
            assert_eq!(session.surface().state().root_text_content().as_ref(), "");
            session.handle(now, SessionInput::Editor(Input::Redo));
            assert_eq!(
                session.surface().state().root_text_content().as_ref(),
                "prepared main"
            );
        } else {
            let Some(prepared) = admission.recover_unadopted()? else {
                panic!("unadopted capsule missing")
            };
            assert_eq!(prepared.next().to_json()?, expected);
            assert!(prepared.receipt().main_publication().is_none());
            assert!(admission.recover_unadopted()?.is_none());
            assert_eq!(session.surface().state().to_json()?, before);
            assert_eq!(session.version(), version);
            assert!(receipt.main_publication().is_none());
            drop(prepared);
        }
    }
    Ok(())
}

#[test]
fn failure_after_adoption_before_publication_is_fatal_not_recoverable()
-> Result<(), Box<dyn std::error::Error>> {
    let mut session = fixture(true, Access::Edit, Arc::new(default_editor_builder))?;
    let before = session.surface().state().to_json()?;
    let prepared = edited_main(&mut session)?;
    let admission = PreparedAdmission::new(prepared);
    let SessionInput::Editor(input) = admission.input() else {
        panic!("editor admission")
    };
    // An invalid batch attempts a second graph write after the sealed adoption.
    // Use the actual command runner, not a synthetic failed publication receipt.
    let output = session.handle(
        Now {
            mono: Millis(1),
            wall: UnixMillis(1),
        },
        SessionInput::Editor(Input::Batch(vec![
            input,
            Input::Command {
                command: Command::InsertText("must fail".into()),
                selection: ViewSelection::KeepModel,
            },
        ])),
    );
    assert!(
        output
            .view
            .iter()
            .any(|effect| matches!(effect, ViewEffect::Error(_)))
    );
    assert!(admission.was_adopted()?);
    assert!(admission.main_publication().is_none());
    assert!(admission.recover_unadopted()?.is_none());
    assert_eq!(session.surface().state().to_json()?, before);
    Ok(())
}

#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
struct OutputFailure;
impl NodeType for OutputFailure {
    const TYPE: &'static str = "prepared-output-failure";
    type Kind = ElementKind;
    impl_default_node!();
}
impl ElementNode for OutputFailure {
    element_node_base!();
    fn adjust_export_json(&self, _: NodeView<'_>, _: &mut SerializedNode) -> Result<(), Error> {
        Err(Error::Invariant("prepared output export failed"))
    }
}

#[test]
fn output_failure_after_publication_keeps_the_receipt_and_cannot_retry()
-> Result<(), Box<dyn std::error::Error>> {
    let mut session = fixture(
        true,
        Access::Edit,
        Arc::new(|mode, peer| default_editor_builder(mode, peer).node::<OutputFailure>()),
    )?;
    let pending = session.suspend_staged_update();
    let (pending, edited) = session.with_staged_update(pending, |tx| -> Result<(), Error> {
        let node = tx.create(OutputFailure)?;
        tx.append(NodeKey::ROOT, &[node.key()])?;
        tx.flush()
    })?;
    edited?;
    let prepared = session.prepare_staged_update(pending)?;
    let admission = PreparedAdmission::new(prepared);
    let output = session.handle(
        Now {
            mono: Millis(1),
            wall: UnixMillis(1),
        },
        admission.input(),
    );
    assert!(
        output
            .view
            .iter()
            .any(|effect| matches!(effect, ViewEffect::Error(_)))
    );
    assert!(admission.was_adopted()?);
    assert!(admission.main_publication().is_some());
    assert!(admission.recover_unadopted()?.is_none());
    let published = admission.main_publication();
    let _output = session.handle(
        Now {
            mono: Millis(2),
            wall: UnixMillis(2),
        },
        admission.input(),
    );
    assert_eq!(admission.main_publication(), published);
    assert!(admission.recover_unadopted()?.is_none());
    Ok(())
}

struct CorrectPastedText(Arc<std::sync::atomic::AtomicUsize>);
impl Plugin for CorrectPastedText {
    fn name(&self) -> &'static str {
        "prepared-paste-correction"
    }
    fn commands(&self) -> &[CommandRegistration] {
        &[]
    }
    fn handle(&self, _: &mut Transaction<'_>, _: &Command) -> Result<Handled, Error> {
        Ok(Handled::No)
    }
    fn after_commit(&self, tx: &mut Transaction<'_>, commit: &Commit) -> Result<(), Error> {
        for (key, mutation) in &commit.changes.mutations {
            self.0.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            if *mutation != Mutation::Destroyed
                && commit.next.view().is_text(*key)
                && commit.next.view().text_content(*key).as_ref() == "correct me"
            {
                tx.text(*key)?.set_text_content("CORRECT ME")?;
                tx.add_tag(UpdateTag::HistoryMerge);
            }
        }
        Ok(())
    }
}

fn correction_paste() -> Command {
    let mut payload = ClipboardPayload::default();
    payload
        .data
        .insert("text/plain".into(), "correct me".into());
    Command::Paste(payload)
}

#[test]
fn corrected_paste_compares_the_drained_chain_and_has_one_undo_step()
-> Result<(), Box<dyn std::error::Error>> {
    let mut results = vec![];
    for staged in [false, true] {
        let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let counter = calls.clone();
        let mut session = fixture(
            true,
            Access::Edit,
            Arc::new(move |mode, peer| {
                default_editor_builder(mode, peer).plugin(CorrectPastedText(counter.clone()))
            }),
        )?;
        let now = Now {
            mono: Millis(1),
            wall: UnixMillis(1),
        };
        let selection = ViewSelection::Range {
            anchor: Point::element(NodeKey::ROOT, ChildIndex(0)),
            focus: Point::element(NodeKey::ROOT, ChildIndex(0)),
            resolution_dirty: false,
        };
        let output = if staged {
            let pending = session.suspend_staged_update();
            let (pending, edited) =
                session.with_staged_update(pending, |tx| -> Result<(), Error> {
                    tx.set_selection(Some(Selection::Range(RangeSelection::new(
                        Point::element(NodeKey::ROOT, ChildIndex(0)),
                        Point::element(NodeKey::ROOT, ChildIndex(0)),
                    ))))?;
                    tx.dispatch(&correction_paste())?;
                    tx.flush()
                })?;
            edited?;
            let before = calls.load(std::sync::atomic::Ordering::Relaxed);
            let prepared = session.prepare_staged_update(pending)?;
            assert_eq!(prepared.next().root_text_content().as_ref(), "correct me");
            assert_eq!(calls.load(std::sync::atomic::Ordering::Relaxed), before);
            assert!(session.surface().state().is_empty_state());
            let admission = PreparedAdmission::new(prepared);
            let output = session.handle(now, admission.input());
            assert!(admission.main_publication().is_some());
            output
        } else {
            session.handle(
                now,
                SessionInput::Editor(Input::Command {
                    command: correction_paste(),
                    selection,
                }),
            )
        };
        assert!(
            !output
                .view
                .iter()
                .any(|effect| matches!(effect, ViewEffect::Error(_)))
        );
        assert_eq!(
            session.surface().state().root_text_content().as_ref(),
            "CORRECT ME"
        );
        let state = session.surface().state();
        let Some(Selection::Range(range)) = state.selection() else {
            panic!("paste range")
        };
        assert_eq!(range.anchor.offset(), 10);
        assert_eq!(range.focus, range.anchor);
        results.push(state.to_json()?);
        session.handle(now, SessionInput::Editor(Input::Undo));
        assert_eq!(session.surface().state().root_text_content().as_ref(), "");
        assert!(!session.surface().history().can_undo);
        session.handle(now, SessionInput::Editor(Input::Redo));
        assert_eq!(
            session.surface().state().root_text_content().as_ref(),
            "CORRECT ME"
        );
    }
    assert_eq!(results[0], results[1]);
    Ok(())
}

#[test]
fn correction_hook_visits_only_changed_records_in_small_and_large_documents()
-> Result<(), Box<dyn std::error::Error>> {
    let mut counts = vec![];
    for paragraphs in [64_u32, 2048] {
        let capacity = usize::try_from(paragraphs)?;
        let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let counter = calls.clone();
        let mut session = fixture(
            true,
            Access::Edit,
            Arc::new(move |mode, peer| {
                default_editor_builder(mode, peer).plugin(CorrectPastedText(counter.clone()))
            }),
        )?;
        let pending = session.suspend_staged_update();
        let (pending, edited) = session.with_staged_update(pending, |tx| -> Result<(), Error> {
            let mut children = Vec::with_capacity(capacity);
            for _ in 0..paragraphs {
                let p = tx.create(Paragraph::default())?;
                let t = tx.create_text("untouched paragraph")?;
                tx.append(p, &[t.key()])?;
                children.push(p.key());
            }
            tx.append(NodeKey::ROOT, &children)?;
            tx.flush()
        })?;
        edited?;
        let seed = PreparedAdmission::new(session.prepare_staged_update(pending)?);
        session.handle(
            Now {
                mono: Millis(1),
                wall: UnixMillis(1),
            },
            seed.input(),
        );
        assert!(seed.main_publication().is_some());
        calls.store(0, std::sync::atomic::Ordering::Relaxed);
        let pending = session.suspend_staged_update();
        let (pending, edited) = session.with_staged_update(pending, |tx| -> Result<(), Error> {
            tx.set_selection(Some(Selection::Range(RangeSelection::new(
                Point::element(NodeKey::ROOT, ChildIndex(paragraphs)),
                Point::element(NodeKey::ROOT, ChildIndex(paragraphs)),
            ))))?;
            tx.dispatch(&correction_paste())?;
            tx.flush()
        })?;
        edited?;
        let main = session.prepare_staged_update(pending)?;
        let before = calls.load(std::sync::atomic::Ordering::Relaxed);
        let admission = PreparedAdmission::new(main);
        let out = session.handle(
            Now {
                mono: Millis(2),
                wall: UnixMillis(2),
            },
            admission.input(),
        );
        assert!(
            !out.view
                .iter()
                .any(|effect| matches!(effect, ViewEffect::Error(_)))
        );
        assert!(admission.main_publication().is_some());
        assert!(
            session
                .surface()
                .state()
                .root_text_content()
                .ends_with("CORRECT ME")
        );
        counts.push(calls.load(std::sync::atomic::Ordering::Relaxed) - before);
    }
    assert!(counts[0] > 0);
    assert_eq!(counts[0], counts[1]);
    Ok(())
}
