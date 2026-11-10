use super::*;
use bebop::Record;
use std::collections::{BTreeMap, BTreeSet};

/// No state, durable-row, reconnect or catchup work repeats during the quiet window.
pub fn quiet(outcome: &Outcome) -> Result<(), Failure> {
    for event in &outcome.quiet_events {
        let noisy = match &event.fact {
            Fact::Frame { kind, .. } => matches!(
                kind,
                FrameKind::Update
                    | FrameKind::CommentUpdate
                    | FrameKind::RequestSince
                    | FrameKind::RequestSnapshot
                    | FrameKind::Snapshot
                    | FrameKind::UpdateSince
            ),
            Fact::WalAppendIssued { .. }
            | Fact::Status { .. }
            | Fact::Opened { .. }
            | Fact::Closed { .. }
            | Fact::RouterSocket { .. }
            | Fact::SocketClose { .. } => true,
            _ => false,
        };
        if noisy {
            return Err(Failure::new(
                "quiet",
                format!(
                    "unexpected quiet-window work at {:?}: {:?}",
                    event.at, event.fact
                ),
            ));
        }
    }
    if outcome.finals != outcome.finals_after_quiet {
        return Err(Failure::new(
            "quiet",
            "final state changed during quiet window",
        ));
    }
    Ok(())
}
/// Released room acknowledgments follow durable writes and successful peer mapping.
pub fn core_acks_after_writes(outcome: &Outcome) -> Result<(), Failure> {
    let mut groups = BTreeMap::new();
    for port in &outcome.server_ports {
        groups
            .entry((port.doc, port.callback))
            .or_insert_with(Vec::new)
            .push(&port.effect);
    }
    // Activated duplicate suppression intentionally issues no new operation put.
    // Bind prior coverage to actual decoded requests, physical row receipts and
    // their observed durability completion, never to the eventual final VV.
    let mut requests = BTreeMap::new();
    let mut routes = BTreeMap::new();
    let mut seeds = Vec::new();
    for (index, event) in outcome.events.iter().enumerate() {
        match &event.fact {
            Fact::ServerReceived {
                doc,
                callback,
                update,
                spans,
            } => {
                if routes
                    .insert((*callback, update.as_str()), *doc)
                    .is_some_and(|prior| prior != *doc)
                {
                    return Err(Failure::new(
                        "core_acks_after_writes",
                        "ambiguous request route",
                    ));
                }
                requests.insert((*doc, *callback, update.as_str()), spans);
            }
            Fact::ServerSeed { doc, vv } => seeds.push((
                index,
                *doc,
                vv.iter()
                    .map(|(peer, end)| IdSpan {
                        peer: *peer,
                        start: 0,
                        end: *end,
                    })
                    .collect::<Vec<_>>(),
            )),
            _ => {}
        }
    }
    let mut prior_receipts = BTreeMap::<DocIx, Vec<_>>::new();
    let mut rows = BTreeMap::<_, Vec<IdSpan>>::new();
    for (index, event) in outcome.events.iter().enumerate() {
        if let Fact::PendingStored {
            doc,
            callback,
            spans,
            ..
        } = &event.fact
        {
            rows.entry((*doc, *callback))
                .or_default()
                .extend(spans.clone());
        }
        if let Fact::ServerDurable { update, callback } = &event.fact
            && let Some(doc) = routes.get(&(*callback, update.as_str()))
            && let Some(spans) = requests.get(&(*doc, *callback, update.as_str()))
            && rows
                .get(&(*doc, *callback))
                .is_some_and(|stored| spans.iter().all(|span| ranges_cover(stored, span)))
        {
            prior_receipts
                .entry(*doc)
                .or_default()
                .push((index, *callback, (*spans).clone()));
        }
    }
    let mut prior_mapped = BTreeMap::<DocIx, BTreeSet<u64>>::new();
    for ((doc, callback), effects) in groups {
        let successful = outcome
            .events
            .iter()
            .find_map(|event| match &event.fact {
                Fact::DirectoryState {
                    doc: target,
                    callback: at,
                    mapped,
                } if *target == doc && *at == callback => {
                    Some(mapped.iter().copied().collect::<BTreeSet<_>>())
                }
                _ => None,
            })
            .unwrap_or_default();
        let mut written = Vec::new();
        let mut mapped = prior_mapped.get(&doc).cloned().unwrap_or_default();
        for effect in effects {
            if matches!(
                effect.operation.as_str(),
                "storage.put" | "storage.operation.put"
            ) && effect.value["key"]
                .as_str()
                .is_some_and(|key| key.starts_with("o/"))
                && let Some(key) = effect.value["key"].as_str()
            {
                for event in &outcome.events {
                    if let Fact::PendingStored {
                        doc: target,
                        callback: at,
                        key: stored,
                        spans,
                        ..
                    } = &event.fact
                        && *target == doc
                        && *at == callback
                        && stored == key
                    {
                        written.extend(spans.clone());
                    }
                }
            }
            if effect.operation == "peers.map_unowned" {
                for peer in effect.value["peers"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|peer| peer.as_str().and_then(|peer| peer.parse::<u64>().ok()))
                {
                    if successful.contains(&peer) {
                        mapped.insert(peer);
                    }
                }
            }
            if effect.operation != "connections.send_binary" {
                continue;
            }
            let frame: Vec<u8> = serde_json::from_value(effect.value["frame"].clone())
                .map_err(|e| Failure::new("core_acks_after_writes", e))?;
            let Some(message) = frame.get(1..) else {
                continue;
            };
            if let Ok(sync_protocol::FromRemote::RemoteUpdateAck { id }) =
                sync_protocol::FromRemote::deserialize(message)
            {
                // Port effects include attempted ACKs discarded by a crash
                // behind the output gate. Those promise no durability: a
                // duplicate can depend on another still-unconfirmed write.
                // Check every actual release, never treat an attempt as one.
                let Some(ack_index) = outcome.events.iter().position(|event|matches!(&event.fact,Fact::AckSent {update,callback:at} if update==id && *at==callback)) else { continue };
                let ranges = requests.get(&(doc, callback, id)).copied().or_else(|| {
                    outcome.events.iter().find_map(|event| match &event.fact {
                        Fact::ServerApplied { update, spans, .. } if update == id => Some(spans),
                        _ => None,
                    })
                });
                let mut covered = written.clone();
                for (at, origin, spans) in prior_receipts.get(&doc).into_iter().flatten() {
                    if *at < ack_index && *origin != callback {
                        covered.extend(spans.clone());
                    }
                }
                for (at, route, spans) in &seeds {
                    if *at < ack_index && *route == doc {
                        covered.extend(spans.clone());
                    }
                }
                let peers_mapped = ranges
                    .is_some_and(|ranges| ranges.iter().all(|range| mapped.contains(&range.peer)));
                // The real core caches mapped peers. A prior successful mapping is
                // valid evidence; requiring a redundant D1 write would reject M9's cache.
                let wrote_all = ranges
                    .is_some_and(|ranges| ranges.iter().all(|range| ranges_cover(&covered, range)));
                if !wrote_all || !peers_mapped {
                    return Err(Failure::new(
                        "core_acks_after_writes",
                        format!(
                            "{id} ack precedes durable-op put or successful mapping in callback{callback}"
                        ),
                    ));
                }
            }
        }
        prior_mapped.insert(doc, successful);
    }
    Ok(())
}
/// New writes require their own durable completion; duplicates require prior real
/// coverage and their current output gate, including any archive-repair writes.
pub fn gate_releases_after_durable(outcome: &Outcome) -> Result<(), Failure> {
    let mut durable = BTreeSet::new();
    let receipts = core_acks_after_writes(outcome);
    for (index, event) in outcome.events.iter().enumerate() {
        match &event.fact {
            Fact::GateReleased {
                required,
                confirmed,
                ..
            } if required > confirmed => {
                return Err(Failure::new(
                    "gate_releases_after_durable",
                    "send released before an earlier write became durable",
                ));
            }
            Fact::ServerDurable { update, callback } => {
                durable.insert((update.clone(), *callback));
            }
            Fact::AckSent { update, callback } => {
                if !durable.contains(&(update.clone(), *callback)) {
                    let route = outcome.events.iter().find_map(|event| match &event.fact {
                        Fact::ServerReceived {
                            doc,
                            callback: at,
                            update: id,
                            ..
                        } if id == update && at == callback => Some(*doc),
                        _ => None,
                    });
                    let prior_only=route.is_some_and(|doc| {
                        let wrote_new=outcome.events.iter().any(|event|matches!(&event.fact,Fact::PendingStored{doc:target,callback:at,..} if *target==doc && at==callback));
                        // World emits this exact proof immediately before each
                        // actual ACK release. A held ACK keeps its request's
                        // callback, while the confirming drain can run under a
                        // later callback; never join those identities by equality.
                        let released=index.checked_sub(1).and_then(|at|outcome.events.get(at)).is_some_and(|event|matches!(&event.fact,Fact::GateReleased{doc:target,required,confirmed,..} if *target==doc && required<=confirmed));
                        !wrote_new && released && receipts.is_ok()
                    });
                    if prior_only {
                        continue;
                    }
                    return Err(Failure::new(
                        "gate_releases_after_durable",
                        format!("{update} ack escaped callback{callback}'s durability gate"),
                    ));
                }
            }
            _ => {}
        }
    }
    Ok(())
}
/// Refused spans stay out of all final vectors unless a separate accepted update carried them.
pub fn refused_updates_never_applied(outcome: &Outcome) -> Result<(), Failure> {
    let accepted = outcome
        .events
        .iter()
        .filter_map(|event| match &event.fact {
            Fact::ServerApplied { spans, .. } => Some(spans),
            _ => None,
        })
        .flatten()
        .cloned()
        .collect::<Vec<_>>();
    for event in &outcome.events {
        let Fact::UpdateRefused { update, spans } = &event.fact else {
            continue;
        };
        for span in spans {
            let retried = ranges_cover(&accepted, span);
            if retried {
                continue;
            }
            let exists =
                outcome.finals.servers.values().any(|server| {
                    server.oplog_vv.get(&span.peer).copied().unwrap_or(0) > span.start
                }) || outcome.finals.clients.values().any(|client| {
                    client.oplog_vv.get(&span.peer).copied().unwrap_or(0) > span.start
                });
            if exists {
                return Err(Failure::new(
                    "refused_updates_never_applied",
                    format!("refused {update}/{span:?} reached a final vector"),
                ));
            }
        }
    }
    Ok(())
}
/// Every actual comment completion agrees with persisted ranges and same-mark retries.
pub fn comment_replies_truthful(outcome: &Outcome) -> Result<(), Failure> {
    for (index, event) in outcome.events.iter().enumerate() {
        let Fact::CommentSent {
            client,
            request,
            mark_id,
            spans,
            ..
        } = &event.fact
        else {
            continue;
        };
        let replies = outcome
            .events
            .iter()
            .filter_map(|event| match &event.fact {
                Fact::CommentReplied {
                    client: target,
                    request: id,
                    reply,
                } if target == client && id == request => Some(reply),
                _ => None,
            })
            .collect::<Vec<_>>();
        if replies.len() != 1 {
            return Err(Failure::new(
                "comment_replies_truthful",
                "comment must have exactly one completion",
            ));
        }
        let doc = outcome.events[..=index]
            .iter()
            .rev()
            .find_map(|event| match &event.fact {
                Fact::Opened {
                    client: target,
                    doc,
                    ..
                } if target == client => Some(*doc),
                _ => None,
            })
            .ok_or_else(|| Failure::new("comment_replies_truthful", "comment has no document"))?;
        let persisted = outcome.finals.servers.get(&doc).is_some_and(|server| {
            spans
                .iter()
                .all(|span| server.persisted_vv.get(&span.peer).copied().unwrap_or(0) >= span.end)
        });
        match replies.first().copied() {
            Some(CommentResult::Accepted) if !persisted => {
                return Err(Failure::new(
                    "comment_replies_truthful",
                    "accepted comment absent from durable server",
                ));
            }
            Some(CommentResult::Refused) => {
                let retried = outcome.events.iter().skip(index + 1).any(|event| match &event.fact { Fact::CommentSent { client, request, mark_id: mark, .. } if mark == mark_id => outcome.events.iter().any(|event| matches!(&event.fact, Fact::CommentReplied { client: target, request: id, reply: CommentResult::Accepted } if target == client && id == request)), _ => false });
                let exists = spans.iter().any(|span| {
                    outcome.finals.servers.values().any(|server| {
                        server.oplog_vv.get(&span.peer).copied().unwrap_or(0) > span.start
                    }) || outcome.finals.clients.values().any(|peer| {
                        peer.oplog_vv.get(&span.peer).copied().unwrap_or(0) > span.start
                    })
                });
                if exists && !retried {
                    return Err(Failure::new(
                        "comment_replies_truthful",
                        "refused comment applied without an accepted same-mark retry",
                    ));
                }
            }
            _ => {}
        }
    }
    Ok(())
}
/// Every AI writer has an AI-range peer, and real active_peers(false) hides it.
pub fn ai_peers_hidden(outcome: &Outcome) -> Result<(), Failure> {
    let mut ai_names = BTreeSet::new();
    let mut ai_peers = BTreeSet::new();
    for event in &outcome.events {
        match &event.fact {
            Fact::Opened {
                client,
                peer,
                kind: ClientKind::AiWorker,
                ..
            } => {
                ai_names.insert(client.clone());
                ai_peers.insert(*peer);
            }
            Fact::ServerCommit { peer, .. } => {
                ai_peers.insert(*peer);
            }
            Fact::PeerAssigned { client, peer, .. } if ai_names.contains(client) => {
                ai_peers.insert(*peer);
            }
            _ => {}
        }
    }
    for peer in &ai_peers {
        if !(*peer >= doc_sync_core::AI_PEER_BASE
            && *peer < doc_sync_core::AI_PEER_BASE + doc_sync_core::AI_PEER_COUNT)
        {
            return Err(Failure::new(
                "ai_peers_hidden",
                "AI peer escaped its reserved block",
            ));
        }
    }
    if outcome.finals.servers.values().any(|server| {
        server
            .active_peers_without_ai
            .iter()
            .any(|peer| ai_peers.contains(peer))
    }) {
        return Err(Failure::new(
            "ai_peers_hidden",
            "AI peer leaked through the real server query",
        ));
    }
    Ok(())
}
/// Collaborative undo/redo may remove only IDs created by the client's own peers.
pub fn undo_reverts_only_own(outcome: &Outcome) -> Result<(), Failure> {
    let mut owned = BTreeMap::<ClientName, Vec<IdSpan>>::new();
    for event in &outcome.events {
        match &event.fact {
            Fact::LocalOp { client, spans, .. } => owned
                .entry(client.clone())
                .or_default()
                .extend(spans.clone()),
            Fact::UndoApplied {
                client, removed, ..
            } => {
                let spans = owned.get(client).map(Vec::as_slice).unwrap_or_default();
                if removed.iter().any(|removed| !ranges_cover(spans, removed)) {
                    return Err(Failure::new(
                        "undo_reverts_only_own",
                        "undo removed another client's operations",
                    ));
                }
            }
            _ => {}
        }
    }
    Ok(())
}
/// Transient transport/directory/storage failures never count as poison evidence.
pub fn no_transient_quarantine(outcome: &Outcome) -> Result<(), Failure> {
    let corruption = outcome.script.iter().any(|step| {
        matches!(
            step,
            Step::Storage {
                fault: StorageFault::CorruptRow,
                ..
            } | Step::Net(NetStep::CorruptNext { .. })
        )
    });
    if !corruption && outcome.events.iter().any(|event| matches!(&event.fact, Fact::RowsParked { rows, .. } if rows.iter().any(|(_, reason)| reason == "Poison"))) { return Err(Failure::new("no_transient_quarantine", "poison parking without a corrupt-row/frame fault")) }
    Ok(())
}
/// Outdated imports and reconnect storms must not become terminal corruption failures.
pub fn no_spurious_terminal(outcome: &Outcome) -> Result<(), Failure> {
    // S8 §8.1 permits terminal corruption after an actually faulty build. An
    // armed configuration alone is not evidence: require its emitted Loro write.
    let faulty_projection = outcome.events.iter().any(|event| {
        matches!(&event.fact,
        Fact::ProjectionFaultWrite { start, end, previous, written, .. }
            if end > start && previous != written)
    });
    let corruption = faulty_projection
        || outcome.script.iter().any(|step| {
            matches!(
                step,
                Step::Storage {
                    fault: StorageFault::CorruptRow | StorageFault::CorruptSnapshot,
                    ..
                } | Step::Net(NetStep::CorruptNext { .. })
                    | Step::Server(ServerStep::CorruptSnapshot)
            )
        });
    let terminal = outcome.finals.clients.values()
        .any(|client| client.terminal.as_deref() == Some("Corrupt"))
        || outcome.events.iter().any(|event| matches!(&event.fact,
            Fact::Status { status, .. } if matches!(status.connection, doc_sync_core::ConnectionStatus::Closed(doc_sync_core::CloseReason::Corrupt))));
    if !corruption && terminal {
        return Err(Failure::new(
            "no_spurious_terminal",
            "terminal corruption without a corruption source",
        ));
    }
    Ok(())
}

/// Every oversized successful operation has bounded, complete physical storage.
pub fn oversized_operations_complete(outcome: &Outcome) -> Result<(), Failure> {
    use sync_server_core::domain::operation_chunks::{CHUNK_BYTES, INLINE_BYTES};
    for event in &outcome.events {
        let Fact::PendingStored {
            key,
            bytes,
            chunks,
            complete,
            ..
        } = &event.fact
        else {
            continue;
        };
        if !complete
            || (*bytes > INLINE_BYTES
                && (chunks.is_empty()
                    || chunks.iter().any(|size| *size == 0 || *size > CHUNK_BYTES)
                    || chunks.iter().sum::<usize>() != *bytes))
        {
            return Err(Failure::new(
                "oversized_operations_complete",
                format!("{key}: incomplete or unbounded operation storage"),
            ));
        }
    }
    Ok(())
}
