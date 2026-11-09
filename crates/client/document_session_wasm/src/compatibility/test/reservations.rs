use super::*;

#[test]
fn reserved_tickets_construct_once_on_the_same_native_allocator() -> Result<(), BoundaryError> {
    let config = wire::SessionConfigMsg {
        doc: "compat-reserved-constructor".into(),
        session: "00000000-0000-0000-0000-000000000001".into(),
        user: "fixture-user".into(),
        peers: vec![27, 28, 29],
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
    let mut editor = EditorSession::create_compat_inner(
        generated::ABI_MAJOR,
        &bytes(&config)?,
        0.0,
        0.0,
        &bytes(&compat::CompatConfig {
            editor_id: 1,
            classes: vec![],
        })?,
    )?;
    let reply = editor.compat_begin_compact_inner(&bytes(&compat::CompatBeginRequest {
        tags: vec![],
        reserve_keys: 2,
        class_mask_patches: vec![],
    })?)?;
    let (host, machine) = editor.compat_parts()?;
    let (_, tickets) = host
        .reservations
        .get_mut(&reply.reservation.reservation_id)
        .unwrap();
    let key = NodeKey::from_parts(KeyParts {
        index: reply.reservation.keys[0].index,
        generation: reply.reservation.keys[0].generation,
    });
    let ticket = tickets.remove(&key).expect("issued capability");
    assert!(tickets.remove(&key).is_none());
    let allocated = host.keys.last_allocated();
    let pending = host.pending.take().expect("pending update");
    let machine::Session::Editor(session) = &mut machine.session else {
        panic!("editor");
    };
    let (pending, created) = session.with_compat_update(pending, |tx| {
        tx.create_reserved_with(ticket, Text::default(), BaseData::Text(TextData::default()))
    })?;
    host.pending = Some(pending);
    assert_eq!(created?.key(), key);
    assert_eq!(host.keys.last_allocated(), allocated);
    editor.compat_discard().expect("discard update");
    assert!(editor
        .compatibility
        .as_ref()
        .unwrap()
        .reservations
        .is_empty());
    editor.compat_begin_inner(&bytes(&compat::CompatBegin { tags: vec![] })?)?;
    let next = editor.compat_reserve_keys_inner(1)?;
    assert!(next.keys[0].index > reply.reservation.keys[1].index);
    editor.compat_discard().expect("discard update");
    Ok(())
}
