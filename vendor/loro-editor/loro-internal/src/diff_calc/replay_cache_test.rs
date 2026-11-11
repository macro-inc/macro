use super::*;
use crate::{cursor::PosType, loro::ExportMode, LoroDoc};
use rand::{rngs::StdRng, Rng, SeedableRng};
use std::{cell::Cell, sync::Mutex};

thread_local! {
    static REFERENCE: Cell<bool> = const { Cell::new(false) };
    static REFERENCE_CALLS: Cell<usize> = const { Cell::new(0) };
}

pub(super) fn use_reference() -> bool {
    REFERENCE.with(Cell::get)
}

fn mode<T>(reference: bool, f: impl FnOnce() -> T) -> T {
    struct Restore(bool);
    impl Drop for Restore {
        fn drop(&mut self) {
            REFERENCE.with(|value| value.set(self.0));
        }
    }
    let _restore = Restore(REFERENCE.with(|value| value.replace(reference)));
    f()
}

fn assert_parity(a: &LoroDoc, b: &LoroDoc, seed: u64, step: usize) {
    assert_eq!(
        a.get_deep_value(),
        b.get_deep_value(),
        "state seed={seed} step={step}"
    );
    assert_eq!(
        a.oplog_vv(),
        b.oplog_vv(),
        "oplog VV seed={seed} step={step}"
    );
    assert_eq!(
        a.oplog_frontiers(),
        b.oplog_frontiers(),
        "oplog frontiers seed={seed} step={step}"
    );
    assert_eq!(
        a.state_frontiers(),
        b.state_frontiers(),
        "state frontiers seed={seed} step={step}"
    );
}

fn event_receipt(event: &crate::event::DiffEvent<'_>) -> serde_json::Value {
    use crate::event::Diff;
    use serde_json::json;
    let diffs: Vec<_> = event.events.iter().map(|event| {
        let diff = match &event.diff {
            Diff::Map(map) => {
                let fields: std::collections::BTreeMap<_, _> = map.updated.iter().map(|(key, value)| {
                    (key.to_string(), json!({"idlp":format!("{:?}", value.idlp), "present":value.value.is_some(),"value":value.value.as_ref().map(|value| value.to_value())}))
                }).collect();
                json!({"map":fields})
            }
            Diff::List(list) => json!({"list":list.iter().map(|item| match item {
                loro_delta::DeltaItem::Retain { len, attr } => json!({"retain":len, "from_move":attr.from_move}),
                loro_delta::DeltaItem::Replace { value, attr, delete } => json!({"insert":value.iter().map(|value| value.to_value()).collect::<Vec<_>>(), "delete":delete,"from_move":attr.from_move}),
            }).collect::<Vec<_>>()}),
            Diff::Text(text) => json!({"text":text.iter().map(|item| match item {
                loro_delta::DeltaItem::Retain { len, attr } => json!({"retain":len,"attributes":attr}),
                loro_delta::DeltaItem::Replace { value, attr, delete } => json!({"insert":value.as_str(),"delete":delete,"attributes":attr}),
            }).collect::<Vec<_>>()}),
            other => json!({"other":format!("{other:?}")}),
        };
        json!({"id":event.id.to_string(),"path":format!("{:?}",event.path),"idx":format!("{:?}",event.idx),"unknown":event.is_unknown,"diff":diff})
    }).collect();
    json!({"target":event.current_target.as_ref().map(ToString::to_string),"from":format!("{:?}",event.event_meta.from),"to":format!("{:?}",event.event_meta.to),"origin":event.event_meta.origin.to_string(),"by":format!("{:?}",event.event_meta.by),"diffs":diffs})
}

#[test]
fn random_multi_container_imports_match_unindexed_replay() {
    let calls_before = REFERENCE_CALLS.with(Cell::get);
    for seed in 0..256 {
        let mut rng = StdRng::seed_from_u64(seed);
        let writers: Vec<_> = (1..=3)
            .map(|peer| {
                let doc = LoroDoc::new_auto_commit();
                doc.set_peer_id(peer).unwrap();
                doc
            })
            .collect();
        for index in 0..6 {
            writers[0]
                .get_text(format!("text-{index}"))
                .insert(0, "seed", PosType::Unicode)
                .unwrap();
            writers[0]
                .get_list(format!("list-{index}"))
                .push(0)
                .unwrap();
            writers[0]
                .get_movable_list(format!("movable-{index}"))
                .push(0.into())
                .unwrap();
        }
        writers[0].get_map("map").insert("seed", true).unwrap();
        writers[0].commit_then_renew();
        let initial = writers[0]
            .export(if seed % 4 == 0 {
                ExportMode::ShallowSnapshot(std::borrow::Cow::Owned(writers[0].oplog_frontiers()))
            } else {
                ExportMode::Snapshot
            })
            .unwrap();
        for writer in &writers[1..] {
            writer.import(&initial).unwrap();
        }
        let patched = LoroDoc::new_auto_commit();
        let reference = LoroDoc::new_auto_commit();
        mode(false, || patched.import(&initial)).unwrap();
        mode(true, || reference.import(&initial)).unwrap();
        let patched_events = Arc::new(Mutex::new(Vec::new()));
        let reference_events = Arc::new(Mutex::new(Vec::new()));
        let events = patched_events.clone();
        let _patched_subscription = patched.subscribe_root(Arc::new(move |event| {
            events.lock().unwrap().push(event_receipt(&event));
        }));
        let events = reference_events.clone();
        let _reference_subscription = reference.subscribe_root(Arc::new(move |event| {
            events.lock().unwrap().push(event_receipt(&event));
        }));
        let mut updates = Vec::new();
        let mut versions = vec![patched.state_frontiers()];
        for step in 0..64 {
            let writer_index = rng.gen_range(0..writers.len());
            let writer = &writers[writer_index];
            let before = writer.oplog_vv();
            let index = rng.gen_range(0..6);
            match rng.gen_range(0..8) {
                0 => {
                    let text = writer.get_text(format!("text-{index}"));
                    text.insert(
                        rng.gen_range(0..=text.len_unicode()),
                        if step % 2 == 0 { "😀" } else { "x" },
                        PosType::Unicode,
                    )
                    .unwrap();
                }
                1 => {
                    let text = writer.get_text(format!("text-{index}"));
                    if text.len_unicode() > 0 {
                        text.delete(rng.gen_range(0..text.len_unicode()), 1, PosType::Unicode)
                            .unwrap();
                    }
                }
                2 => {
                    let list = writer.get_list(format!("list-{index}"));
                    list.insert(rng.gen_range(0..=list.len()), step as i64)
                        .unwrap();
                }
                3 => {
                    let list = writer.get_list(format!("list-{index}"));
                    if list.len() > 0 {
                        list.delete(rng.gen_range(0..list.len()), 1).unwrap();
                    }
                }
                4 => {
                    let list = writer.get_movable_list(format!("movable-{index}"));
                    list.insert(rng.gen_range(0..=list.len()), step as i64)
                        .unwrap();
                }
                5 => {
                    let list = writer.get_movable_list(format!("movable-{index}"));
                    if list.len() > 1 {
                        list.mov(rng.gen_range(0..list.len()), rng.gen_range(0..list.len()))
                            .unwrap();
                    }
                }
                6 => {
                    writer
                        .get_map("map")
                        .insert(&format!("key-{index}"), step as i64)
                        .unwrap();
                }
                _ => {
                    let nested = writer
                        .get_map("nested")
                        .insert_container(
                            &format!("child-{step}"),
                            crate::TextHandler::new_detached(),
                        )
                        .unwrap();
                    nested.insert(0, "nested😀", PosType::Unicode).unwrap();
                }
            }
            writer.commit_then_renew();
            updates.push(writer.export(ExportMode::updates(&before)).unwrap());
            // Keep concurrent writers, while occasionally learning another peer's
            // complete causal history. Receivers get incremental updates out of order.
            if step % 5 == 0 {
                let snapshot = writer.export(ExportMode::Snapshot).unwrap();
                writers[(writer_index + 1) % writers.len()]
                    .import(&snapshot)
                    .unwrap();
            }
            let update = &updates[rng.gen_range(0..updates.len())];
            let a = mode(false, || patched.import(update)).unwrap();
            let b = mode(true, || reference.import(update)).unwrap();
            assert_eq!(
                a.success, b.success,
                "import success seed={seed} step={step}"
            );
            assert_eq!(a.pending, b.pending, "pending seed={seed} step={step}");
            assert_parity(&patched, &reference, seed, step);
            assert_eq!(
                *patched_events.lock().unwrap(),
                *reference_events.lock().unwrap(),
                "events/diffs seed={seed} step={step}"
            );
            patched_events.lock().unwrap().clear();
            reference_events.lock().unwrap().clear();
            versions.push(patched.state_frontiers());
            if step % 7 == 0 {
                let version = &versions[rng.gen_range(0..versions.len())];
                mode(false, || patched.checkout(version)).unwrap();
                mode(true, || reference.checkout(version)).unwrap();
                assert_parity(&patched, &reference, seed, step);
                assert_eq!(
                    *patched_events.lock().unwrap(),
                    *reference_events.lock().unwrap(),
                    "checkout events seed={seed} step={step}"
                );
                patched_events.lock().unwrap().clear();
                reference_events.lock().unwrap().clear();
                mode(false, || patched.attach());
                mode(true, || reference.attach());
                assert_parity(&patched, &reference, seed, step);
                assert_eq!(
                    *patched_events.lock().unwrap(),
                    *reference_events.lock().unwrap(),
                    "attach events seed={seed} step={step}"
                );
                patched_events.lock().unwrap().clear();
                reference_events.lock().unwrap().clear();
            }
        }
        for writer in &writers {
            let snapshot = writer.export(ExportMode::Snapshot).unwrap();
            mode(false, || patched.import(&snapshot)).unwrap();
            mode(true, || reference.import(&snapshot)).unwrap();
            assert_parity(&patched, &reference, seed, 64);
            assert_eq!(
                *patched_events.lock().unwrap(),
                *reference_events.lock().unwrap(),
                "final events seed={seed}"
            );
            patched_events.lock().unwrap().clear();
            reference_events.lock().unwrap().clear();
        }
    }
    assert!(
        REFERENCE_CALLS.with(Cell::get) > calls_before,
        "property must exercise the unpatched rebuild path"
    );
}

#[cold]
#[inline(never)]
pub(super) fn reference_replay(
    idx: ContainerIdx,
    oplog: &OpLog,
    vv: &VersionVector,
    visitor: &mut dyn RebuildOpVisitor,
) {
    REFERENCE_CALLS.with(|calls| calls.set(calls.get() + 1));
    let empty_vv = VersionVector::default();
    let empty_frontiers = Frontiers::default();
    let target_frontiers = oplog.dag.vv_to_frontiers(vv);
    let (_, iter) =
        oplog.iter_from_replay_base_causally(&empty_vv, &empty_frontiers, vv, &target_frontiers);

    for (change, (start_counter, end_counter), vv) in iter {
        let iter_start = change
            .ops
            .binary_search_by(|op| op.ctr_last().cmp(&start_counter))
            .unwrap_or_else(|e| e);
        for mut op in &change.ops.vec()[iter_start..] {
            if op.counter >= end_counter {
                break;
            }

            if op.container != idx || op.ctr_last() < start_counter {
                continue;
            }

            let stack_sliced_op;
            if op.counter < start_counter || op.ctr_end() > end_counter {
                stack_sliced_op = Some(op.slice(
                    (start_counter as usize).saturating_sub(op.counter as usize),
                    op.atom_len().min((end_counter - op.counter) as usize),
                ));
                op = stack_sliced_op.as_ref().unwrap();
            }

            let vv = &mut vv.borrow_mut();
            vv.extend_to_include_end_id(ID::new(change.peer(), op.counter));
            visitor.visit(vv, RichOp::new_by_change(&change, op));
        }
    }
}

#[derive(Default)]
struct ReplayTrace(Vec<(VersionVector, String, IdFull, i64, usize, usize)>);
impl RebuildOpVisitor for ReplayTrace {
    fn visit(&mut self, vv: &VersionVector, op: RichOp<'_>) {
        self.0.push((
            vv.clone(),
            format!("{:?}", op.raw_op()),
            op.id_full(),
            op.timestamp(),
            op.start(),
            op.end(),
        ));
    }
}

fn assert_stream_parity(doc: &LoroDoc, target: &VersionVector) {
    let oplog = doc.oplog().lock();
    let index = OnceCell::new();
    index.set(FullReplayIndex::new(&oplog, target)).unwrap();
    for idx in index.get().unwrap().containers.keys() {
        let mut patched = ReplayTrace::default();
        let mut reference = ReplayTrace::default();
        mode(false, || {
            replay_container_ops_from_empty(*idx, &oplog, target, &mut patched, &index)
        });
        reference_replay(*idx, &oplog, target, &mut reference);
        assert_eq!(patched.0, reference.0, "exact visitor stream for {idx:?}");
    }
}

#[test]
fn sliced_and_shallow_replay_visits_match_reference() {
    let doc = LoroDoc::new_auto_commit();
    doc.set_peer_id(1).unwrap();
    doc.get_text("text")
        .insert(0, "abcdefgh😀", PosType::Unicode)
        .unwrap();
    doc.commit_then_renew();
    let end = doc.oplog_vv().get(&1).copied().unwrap();
    for counter in 1..=end {
        let mut target = doc.oplog_vv();
        target.insert(1, counter);
        assert_stream_parity(&doc, &target);
    }
    let mut cut = doc.oplog_vv();
    cut.insert(1, 3);
    let frontier = doc.oplog().lock().dag.vv_to_frontiers(&cut);
    let snapshot = doc
        .export(ExportMode::ShallowSnapshot(std::borrow::Cow::Owned(
            frontier,
        )))
        .unwrap();
    let shallow = LoroDoc::new_auto_commit();
    shallow.import(&snapshot).unwrap();
    for counter in 4..=end {
        let mut target = doc.oplog_vv();
        target.insert(1, counter);
        assert_stream_parity(&shallow, &target);
    }
}

#[test]
fn many_peer_history_retains_linear_index_payload() {
    let doc = LoroDoc::new_auto_commit();
    for step in 0..2048 {
        doc.set_peer_id((step % 256 + 1) as u64).unwrap();
        doc.get_list(format!("list-{}", step % 32))
            .push(step as i64)
            .unwrap();
        doc.commit_then_renew();
    }
    let target = doc.oplog_vv();
    assert_eq!(target.len(), 256);
    let oplog = doc.oplog().lock();
    let index = FullReplayIndex::new(&oplog, &target);
    let positions: usize = index.containers.values().map(Vec::len).sum();
    let payload = index.changes.capacity() * std::mem::size_of::<FullReplayChange>()
        + index
            .containers
            .values()
            .map(|ops| ops.capacity() * std::mem::size_of::<(usize, usize)>())
            .sum::<usize>();
    assert_eq!(positions, 2048);
    assert!(
        payload <= positions * 128,
        "linear retained replay payload: {payload}"
    );
    println!(
        "REPLAY_INDEX peers={} changes={} positions={} payload_bytes={} mutable_contexts=1",
        target.len(),
        index.changes.len(),
        positions,
        payload
    );
    drop(oplog);
    assert_stream_parity(&doc, &target);
}
