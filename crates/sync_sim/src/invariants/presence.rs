use super::*;
use std::collections::{BTreeMap, BTreeSet};

/// At first quiescence every live form client sees exactly its document's selected peers.
pub fn presence_converged(outcome: &Outcome) -> Result<(), Failure> {
    if outcome.events.iter().any(|event| matches!(&event.fact, Fact::ClockSkew { wall_offset_ms, .. } if wall_offset_ms.unsigned_abs() > outcome.config.session.presence_timeout.0.unsigned_abs() / 2)) { return Ok(()) }
    let views = outcome.finals.presence.as_ref().ok_or_else(|| {
        Failure::new(
            "presence_converged",
            "no first-quiescence presence snapshot",
        )
    })?;
    for (name, client) in &outcome.finals.clients {
        if !client.alive || client.terminal.is_some() {
            continue;
        }
        let expected = outcome
            .finals
            .clients
            .iter()
            .filter(|(other, peer)| {
                *other != name
                    && peer.alive
                    && peer.terminal.is_none()
                    && peer.doc == client.doc
                    && peer
                        .editor
                        .as_ref()
                        .map_or(peer.selection.is_some(), |editor| {
                            editor.selection.is_some()
                        })
            })
            .map(|(_, peer)| {
                (
                    peer.presence_key.clone(),
                    peer.editor.as_ref().map_or_else(
                        || peer.selection.map(serde_json::Value::from),
                        |editor| editor.selection.clone(),
                    ),
                )
            })
            .collect::<BTreeMap<_, _>>();
        let actual = views
            .get(name)
            .ok_or_else(|| Failure::new("presence_converged", format!("missing {name:?} view")))?;
        if actual.keys().collect::<BTreeSet<_>>() != expected.keys().collect::<BTreeSet<_>>() {
            return Err(Failure::new(
                "presence_converged",
                format!(
                    "{name:?}: expected keys {:?}, got {:?}",
                    expected.keys(),
                    actual.keys()
                ),
            ));
        }
        for (key, selection) in expected {
            let selected = actual.get(&key).and_then(|value| value.get("selection"));
            if selected != selection.as_ref() {
                return Err(Failure::new(
                    "presence_converged",
                    format!("{name:?}/{key}: selection differs"),
                ));
            }
        }
    }
    Ok(())
}
/// A crashed or isolated peer's existing key expires within timeout plus observed latency/skew.
pub fn presence_expires(outcome: &Outcome) -> Result<(), Failure> {
    let max_latency = outcome
        .script
        .iter()
        .filter_map(|step| match step {
            Step::Net(NetStep::Profile(profile)) => {
                Some(profile.latency.0.0.max(profile.latency.1.0))
            }
            _ => None,
        })
        .max()
        .unwrap_or(0)
        .max(
            outcome
                .config
                .net
                .latency
                .0
                .0
                .max(outcome.config.net.latency.1.0),
        );
    // Expiry compares a sender timestamp with a receiver's injected wall clock.
    // Opposite signed offsets add: +2400 and -2400 require4800ms, not2400.
    // Observed global bounds are a conservative fixed budget, never a waiver.
    let (min_skew, max_skew) = outcome
        .events
        .iter()
        .filter_map(|event| match &event.fact {
            Fact::ClockSkew { wall_offset_ms, .. } => Some(*wall_offset_ms),
            _ => None,
        })
        .fold((0i64, 0i64), |(min, max), skew| {
            (min.min(skew), max.max(skew))
        });
    let skew = max_skew.abs_diff(min_skew);
    let observed_until = outcome.events.last().map(|event| event.at.0).unwrap_or(0);
    for (index, event) in outcome.events.iter().enumerate() {
        let (source, partition) = match &event.fact {
            Fact::Crashed { client } => (client, false),
            Fact::Partition {
                client,
                partitioned: true,
            } => (client, true),
            _ => continue,
        };
        let deadline = event
            .at
            .0
            .saturating_add(outcome.config.session.presence_timeout.0.unsigned_abs())
            .saturating_add(1)
            .saturating_add(max_latency)
            .saturating_add(skew);
        if observed_until < deadline {
            continue;
        }
        if partition && outcome.events.iter().skip(index + 1).any(|event| event.at.0 <= deadline && matches!(&event.fact, Fact::Partition { client, partitioned: false } if client == source)) { continue }
        let opened = outcome
            .events
            .iter()
            .take(index)
            .rev()
            .find_map(|event| match &event.fact {
                Fact::Opened {
                    client,
                    session,
                    peer,
                    kind,
                    profile,
                    doc,
                    ..
                } if client == source => Some((*session, *peer, *kind, profile, *doc)),
                _ => None,
            });
        let Some((session, peer, kind, source_profile, doc)) = opened else {
            continue;
        };
        let key = if kind == ClientKind::AiWorker {
            format!("ai-{}", session.0)
        } else {
            outcome
                .events
                .iter()
                .take(index)
                .rev()
                .find_map(|event| match &event.fact {
                    Fact::PeerAssigned {
                        client,
                        peer,
                        purpose,
                    } if client == source && purpose == "reset" => Some(peer.to_string()),
                    Fact::Opened { client, .. } if client == source => Some(peer.to_string()),
                    _ => None,
                })
                .unwrap_or_else(|| peer.to_string())
        };
        for target in outcome.finals.clients.keys() {
            if target == source {
                continue;
            }
            // Expiry belongs to the receiver epoch that actually observed the
            // key. A receiver already dead before this source fault cannot tick;
            // never carry an old incarnation's view across a later Opened.
            let Some(receiver_open) = outcome.events[..index].iter().rposition(
                |event| matches!(&event.fact, Fact::Opened { client, .. } if client == target),
            ) else {
                continue;
            };
            let Fact::Opened {
                session: receiver_session,
                profile: receiver_profile,
                doc: receiver_doc,
                ..
            } = &outcome.events[receiver_open].fact
            else {
                unreachable!("receiver_open points to Opened")
            };
            if *receiver_doc != doc
                || outcome.events[receiver_open..index]
                    .iter()
                    .any(|event| receiver_stopped(&event.fact, target, *receiver_session))
            {
                continue;
            }
            // A network-only partition does not disconnect BroadcastChannel peers.
            if partition && receiver_profile == source_profile {
                continue;
            }
            let ends_epoch = |fact: &Fact| {
                receiver_stopped(fact, target, *receiver_session)
                    || matches!(fact, Fact::Opened { client, .. } if client == target)
            };
            // Eligibility belongs to this incarnation at its deadline, never
            // the final diagnostic state after later crashes or document changes.
            if outcome
                .events
                .iter()
                .skip(index + 1)
                .any(|event| event.at.0 <= deadline && ends_epoch(&event.fact))
            {
                continue;
            }
            let before = outcome
                .events
                .iter()
                .take(index)
                .skip(receiver_open)
                .rev()
                .find_map(|event| match &event.fact {
                    Fact::PresenceChanged { client, remote } if client == target => Some(remote),
                    _ => None,
                });
            if before.is_none_or(|view| !view.contains_key(&key)) {
                continue;
            }
            // A suspended receiver cannot run expiry callbacks. Defer only
            // this observation until its actual thaw (which delivers a Tick),
            // rather than forgiving stale presence after it resumes.
            let frozen = outcome
                .events
                .iter()
                .skip(receiver_open)
                .take_while(|event| event.at.0 <= deadline)
                .filter_map(|event| match &event.fact {
                    Fact::Frozen { client } if client == target => Some(true),
                    Fact::Thawed { client } | Fact::Opened { client, .. } if client == target => {
                        Some(false)
                    }
                    _ => None,
                })
                .last()
                .unwrap_or(false);
            let receiver_deadline =
                if frozen {
                    match outcome.events.iter().find(|event| {
                    event.at.0 > deadline
                        && (ends_epoch(&event.fact)
                            || matches!(&event.fact, Fact::Thawed { client } if client == target))
                }) {
                    Some(Event { at, fact: Fact::Thawed { .. } }) => at.0,
                    _ => continue,
                }
                } else {
                    deadline
                };
            // Event order matters when thaw and a later reopen share a clock
            // value. A fresh incarnation's empty view cannot clear this debt.
            let epoch_end = outcome
                .events
                .iter()
                .enumerate()
                .skip(index + 1)
                .find_map(|(end, event)| ends_epoch(&event.fact).then_some(end))
                .unwrap_or(outcome.events.len());
            let at_deadline = outcome.events[receiver_open..epoch_end]
                .iter()
                .rev()
                .find_map(|event| match &event.fact {
                    Fact::PresenceChanged { client, remote }
                        if client == target && event.at.0 <= receiver_deadline =>
                    {
                        Some(remote)
                    }
                    _ => None,
                });
            if at_deadline.is_some_and(|view| view.contains_key(&key)) {
                return Err(Failure::new(
                    "presence_expires",
                    format!(
                        "{target:?} retained {source:?}/{key} past receiver deadline{receiver_deadline}"
                    ),
                ));
            }
        }
    }
    Ok(())
}

// Status does not carry a session id, so callers constrain it to the receiver's
// Opened epoch. Explicit Close must additionally match the issued session.
fn receiver_stopped(fact: &Fact, target: &ClientName, session: doc_sync_core::SessionId) -> bool {
    match fact {
        Fact::Crashed { client } => client == target,
        Fact::Closed {
            client,
            session: closed,
        } => client == target && *closed == session,
        Fact::Status { client, status } => {
            client == target
                && matches!(
                    status.connection,
                    doc_sync_core::ConnectionStatus::Closed(_)
                )
        }
        _ => false,
    }
}
