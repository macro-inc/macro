use super::*;
use lexical_model::*;
struct Probe;
impl ForeignHooks for Probe {
    fn indent(&self, _: NodeView<'_>, _: &ForeignData) -> Override<u32> {
        let request = compat::CompatRequest {
            operation: compat::CompatOperation::GetRoot,
            historical: false,
            state_version: 0,
            has_receiver: false,
            receiver: super::super::test::NO_RECORD,
            args: vec![],
        };
        let available = CURRENT.with(|metadata| metadata.prepare(&request).is_ok());
        Override::Value(if available { 17 } else { 99 })
    }
}
#[test]
fn node_hook_can_reborrow_metadata_after_authorization() -> Result<(), BoundaryError> {
    let config = wire::SessionConfigMsg {
        doc: "compat-scope-probe".into(),
        session: "00000000-0000-0000-0000-000000000001".into(),
        user: "fixture-user".into(),
        peers: vec![47, 48, 49],
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
    let mut session = EditorSession::create_compat_inner(
        generated::ABI_MAJOR,
        &bytes(&config)?,
        0.0,
        0.0,
        &bytes(&compat::CompatConfig {
            editor_id: 1,
            classes: vec![],
        })?,
    )?;
    let snapshot = session.compat_snapshot_inner(0)?;
    let receiver = snapshot.batch.records[0].record;
    session.compat_begin_inner(&bytes(&compat::CompatBegin { tags: vec![] })?)?;
    // A standalone model isolates the scope's borrow contract from session policy.
    // Both graphs contain only the universal root; no foreign node key is imported.
    let mut model = Editor::builder(EditorMode::Headless)
        .foreign_native_hooks("root", Arc::new(Probe))
        .build()
        .expect("root overlay");
    let mut tx = model.transaction();
    let result = dispatch(
        session.compatibility.as_mut().unwrap(),
        &mut tx,
        &compat::CompatRequest {
            operation: compat::CompatOperation::GetIndent,
            historical: false,
            state_version: 0,
            has_receiver: true,
            receiver,
            args: vec![],
        },
    )?;
    assert!(matches!(
        result,
        ResultValue::Scalar(compat::ForeignCallbackValue::ForeignNumberArgument { value: 17.0 })
    ));
    assert!(!CURRENT.is_set());
    Ok(())
}
