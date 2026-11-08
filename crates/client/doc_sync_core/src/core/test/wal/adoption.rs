use super::*;

#[test]
fn rejected_orphan_adoption_stays_busy_until_the_real_reload() {
    let mut h = Harness::running(TransportKind::None, Persistence::Durable);
    load_rows(&mut h, vec![row(1)]);
    let id = h.storage_id();
    h.send(SyncInput::Storage(StorageEvent::Adopted {
        id,
        result: Err(StorageFailure::Other),
    }));
    assert!(
        !h.core.is_idle(),
        "a scheduled recovery load is unfinished work"
    );
    h.at(2_000, SyncInput::Tick);
    assert!(h.out.io.iter().any(|effect| matches!(
        effect,
        IoEffect::Storage {
            op: StorageOp::Load { .. },
            ..
        }
    )));
}
