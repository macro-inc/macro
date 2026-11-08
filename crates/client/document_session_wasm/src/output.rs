use crate::*;
use doc_sync_core::*;
use document_session::{InitialView, SessionOutput, ViewEffect};
use lexical_model::{DiffBuffer, Effect};
pub(crate) fn view(kind: u8) -> wire::ViewEffectMsg {
    wire::ViewEffectMsg {
        kind,
        request: 0,
        code: 0,
        detail: 0,
        flag: false,
        text: String::new(),
        selection: editor_input::empty_selection(),
        format: 0,
        style: String::new(),
        keys: vec![],
        values: vec![],
        events: vec![],
        paths: vec![],
        closed_reason: wire::ClosedReason::None,
        save_reason: wire::SaveReason::None,
    }
}
fn pad(out: &mut Vec<u8>) {
    while !out.len().is_multiple_of(4) {
        out.push(0);
    }
}
pub(crate) fn entry(out: &mut Vec<u8>, tag: u32, a: u32, b: u32, payload: &[u8]) {
    for v in [tag, a, b, payload.len() as u32] {
        out.extend(v.to_le_bytes());
    }
    out.extend(payload);
    pad(out);
}
pub(crate) struct TextCorrection {
    pub(crate) diff: lexical_model::Diff,
    pub(crate) initialize: bool,
}
pub(crate) fn encode(
    output: &SessionOutput,
    terminal: bool,
    buffer: &mut Vec<u8>,
    correction: Option<TextCorrection>,
) -> Result<u32, BoundaryError> {
    if output.view.is_empty()
        && output.io.is_empty()
        && !output.need_peer_ids
        && correction.is_none()
    {
        buffer.clear();
        return Ok(0);
    }
    let mut diff = DiffBuffer::default();
    let mut combined: Option<lexical_model::Diff> = None;
    let mut entries = vec![];
    let mut count = 0;
    let mut flags = 0;
    for v in &output.view {
        flags |= 1;
        let mut m = view(0);
        match v {
            ViewEffect::Initialize(InitialView::Editor { diff: d, .. }) | ViewEffect::Diff(d) => {
                if matches!(v, ViewEffect::Initialize(_)) {
                    entry(&mut entries, 16, 8, 0, &bytes(&view(8))?);
                    count += 1;
                }
                if let Some(previous) = &mut combined {
                    if d.full_reconcile {
                        *previous = d.clone();
                    } else if previous.generation == d.generation {
                        previous.ops.extend(d.ops.clone());
                        previous.view_text_matches = d.view_text_matches;
                    } else {
                        return Err(BoundaryError::Invalid("diff generation"));
                    }
                } else {
                    combined = Some(d.clone());
                }
                continue;
            }
            ViewEffect::Initialize(InitialView::Generic(values)) => {
                m.kind = 1;
                for (p, v) in values {
                    m.paths.push(generic::wire_path(p));
                    generic::flatten(v, String::new(), &mut m.values);
                }
            }
            ViewEffect::EndComposition => {
                m.kind = 9;
            }
            ViewEffect::Error(error) => {
                flags |= 16;
                m.kind = 2;
                m.text = error.to_string();
            }
            ViewEffect::Status(status) => {
                m.kind = 3;
                m.code = match status.connection {
                    ConnectionStatus::Connecting => 0,
                    ConnectionStatus::Connected => 1,
                    ConnectionStatus::Disconnected => 2,
                    ConnectionStatus::Offline => 3,
                    ConnectionStatus::Closed(_) => 4,
                };
                m.detail = match status.save {
                    SaveState::Saved => 0,
                    SaveState::Saving => 1,
                    SaveState::Unsaved(_) => 2,
                };
                m.closed_reason = match &status.connection {
                    ConnectionStatus::Closed(CloseReason::Stopped) => wire::ClosedReason::Stopped,
                    ConnectionStatus::Closed(CloseReason::Unauthorized) => {
                        wire::ClosedReason::Unauthorized
                    }
                    ConnectionStatus::Closed(CloseReason::Corrupt) => wire::ClosedReason::Corrupt,
                    _ => wire::ClosedReason::None,
                };
                m.save_reason = match &status.save {
                    SaveState::Unsaved(UnsavedReason::Undelivered) => wire::SaveReason::Undelivered,
                    SaveState::Unsaved(UnsavedReason::Storage) => wire::SaveReason::Storage,
                    SaveState::Unsaved(UnsavedReason::ReadOnly) => wire::SaveReason::ReadOnly,
                    SaveState::Unsaved(UnsavedReason::Poison) => wire::SaveReason::Poison,
                    SaveState::Unsaved(UnsavedReason::Gap) => wire::SaveReason::Gap,
                    SaveState::Unsaved(UnsavedReason::Rebasing) => wire::SaveReason::Rebasing,
                    _ => wire::SaveReason::None,
                };
                m.flag = status.pending_import;
            }
            ViewEffect::CommitTags(tags) => {
                m.kind = 11;
                m.keys.clone_from(tags);
            }
            ViewEffect::Cursors(peers) => {
                let mut marker = view(10);
                marker.flag = true;
                entry(&mut entries, 16, 10, 0, &bytes(&marker)?);
                count += 1;
                for peer in peers {
                    let mut cursor = view(10);
                    cursor.keys = vec![peer.key.clone(), peer.color.clone()];
                    cursor.selection = editor_input::view_selection(&peer.selection);
                    entry(&mut entries, 16, 10, 0, &bytes(&cursor)?);
                    count += 1;
                }
                continue;
            }
            ViewEffect::Presence(peers) => {
                m.kind = 4;
                for peer in peers {
                    m.keys.push(peer.key.clone());
                    generic::flatten(
                        &generic::loro_value(peer.value.clone())?,
                        String::new(),
                        &mut m.values,
                    );
                }
            }
            ViewEffect::Reply { request, reply } => {
                m.kind = 5;
                m.request = request.0;
                match reply {
                    Reply::Stopped => m.code = 0,
                    Reply::Flush(r) => {
                        m.code = 1;
                        m.detail = match r {
                            FlushReply::Drained => 0,
                            FlushReply::NotDrained { undelivered } => {
                                m.format = *undelivered;
                                1
                            }
                            FlushReply::Offline => 2,
                            FlushReply::ReadOnly => 3,
                        };
                    }
                    Reply::Comment(r) => {
                        m.code = 2;
                        m.detail = match r {
                            CommentReply::Accepted => 0,
                            CommentReply::NotAcked => 1,
                            CommentReply::Refused(reason) => {
                                m.text = format!("{reason:?}");
                                2
                            }
                        };
                    }
                    Reply::Snapshot(r) => {
                        m.code = 3;
                        match r {
                            Ok(bytes) => {
                                m.values.push(wire::DocValueNode {
                                    kind: 5,
                                    key: String::new(),
                                    num: 0.0,
                                    int: 0,
                                    str: String::new(),
                                    bytes: bytes.clone(),
                                    children: 0,
                                });
                            }
                            Err(e) => {
                                m.detail = 1;
                                m.text = e.to_string();
                            }
                        }
                    }
                }
            }
            ViewEffect::Editor(e) => {
                m.kind = 6;
                match e {
                    Effect::SetViewSelection {
                        selection,
                        format,
                        style,
                    } => {
                        m.code = 0;
                        m.selection = editor_input::view_selection(selection);
                        m.format = format.bits();
                        m.style = style.to_string();
                    }
                    Effect::HistoryState(h) => {
                        m.code = 1;
                        m.flag = h.can_undo;
                        m.detail = u32::from(h.can_redo);
                    }
                    Effect::PreventDefault => m.code = 2,
                    Effect::SelectionChange => m.code = 3,
                    Effect::ScrollIntoView(key) => {
                        m.code = 4;
                        m.detail = key.index();
                    }
                    Effect::DecoratorsChanged(keys) => {
                        m.code = 5;
                        m.keys = keys.iter().map(|k| k.index().to_string()).collect();
                    }
                    Effect::TextContentChanged => m.code = 6,
                    Effect::ScheduleRemoveEmptyText { key, delay_ms } => {
                        m.code = 7;
                        m.detail = key.index();
                        m.format = *delay_ms;
                    }
                    Effect::RemoteNodesCreated(keys) => {
                        m.code = 8;
                        m.keys = keys
                            .iter()
                            .map(|(local, key)| format!("{}:{}", local.0, key.index()))
                            .collect();
                    }
                    Effect::PluginEvent(event) => {
                        m.code = 9;
                        m.text = event.name().into();
                    }
                    Effect::FollowUpFailed { plugin, kind, .. } => {
                        m.code = 10;
                        m.keys = vec![(*plugin).into(), (*kind).into()];
                    }
                }
            }
            ViewEffect::DocChanged(events) => {
                m.kind = 7;
                m.events = events
                    .iter()
                    .map(generic::event)
                    .collect::<Result<_, _>>()?;
            }
        }
        entry(&mut entries, 16, u32::from(m.kind), m.request, &bytes(&m)?);
        count += 1;
    }
    if let Some(correction) = correction {
        flags |= 1;
        if correction.initialize {
            combined = Some(correction.diff);
            entry(&mut entries, 16, 8, 0, &bytes(&view(8))?);
            count += 1;
        } else if let Some(previous) = &mut combined {
            previous.ops.extend(correction.diff.ops);
            previous.view_text_matches = None;
        } else {
            combined = Some(correction.diff);
        }
    }
    if let Some(combined) = combined {
        combined.encode(&mut diff);
    }
    for e in &output.io {
        flags |= 2;
        match e {
            IoEffect::FetchToken { attempt, doc } => {
                entry(&mut entries, 1, *attempt, 0, doc.to_string().as_bytes())
            }
            IoEffect::SocketConnect {
                conn,
                doc,
                token,
                traceparent,
            } => entry(
                &mut entries,
                2,
                conn.0,
                0,
                &bytes(&wire::ConnectMsg {
                    doc: doc.to_string(),
                    token: token.expose_secret().to_owned(),
                    traceparent: traceparent.clone().unwrap_or_default(),
                })?,
            ),
            IoEffect::SocketSend { conn, frame } => entry(&mut entries, 3, conn.0, 0, frame),
            IoEffect::SocketPing { conn } => entry(&mut entries, 4, conn.0, 0, &[]),
            IoEffect::SocketClose { conn, code, .. } => {
                entry(&mut entries, 5, conn.0, u32::from(*code), &[])
            }
            IoEffect::Storage { id, op } => {
                let m = storage::encode(op, terminal);
                entry(&mut entries, 6, id.0, u32::from(m.kind), &bytes(&m)?);
            }
            IoEffect::ChatterPost(c) => match c {
                ChatterMessage::Update(v) => entry(&mut entries, 7, 0, 0, v),
                ChatterMessage::Awareness(v) => entry(&mut entries, 7, 1, 0, v),
                ChatterMessage::Closing(id) => {
                    entry(&mut entries, 7, 2, 0, id.0.to_string().as_bytes())
                }
            },
            IoEffect::Telemetry(t) => {
                let (kind, name, outcome, error) = match t.kind {
                    TelemetryKind::Start { name } => (0, name, "", false),
                    TelemetryKind::Event { name } => (1, name, "", false),
                    TelemetryKind::End { outcome, error } => (2, "", outcome, error),
                };
                let attrs = t
                    .attrs
                    .iter()
                    .map(|(key, v)| {
                        let mut a = wire::AttrMsg {
                            key: (*key).into(),
                            kind: 0,
                            text: String::new(),
                            unsigned: 0,
                            signed: 0,
                            flag: false,
                        };
                        match v {
                            AttrValue::String(v) => a.text = v.clone(),
                            AttrValue::U64(v) => {
                                a.kind = 1;
                                a.unsigned = *v;
                            }
                            AttrValue::I64(v) => {
                                a.kind = 2;
                                a.signed = *v;
                            }
                            AttrValue::Bool(v) => {
                                a.kind = 3;
                                a.flag = *v;
                            }
                        }
                        a
                    })
                    .collect();
                entry(
                    &mut entries,
                    8,
                    0,
                    0,
                    &bytes(&wire::TelemetryMsg {
                        span: t.span.0,
                        parent: 0,
                        kind,
                        name: name.into(),
                        outcome: outcome.into(),
                        error,
                        attrs,
                    })?,
                );
            }
            IoEffect::RouteDetach { doc } => {
                entry(&mut entries, 9, 0, 0, doc.to_string().as_bytes())
            }
            IoEffect::RouteReconnect { doc } => {
                entry(&mut entries, 10, 0, 0, doc.to_string().as_bytes())
            }
            IoEffect::RouterConnect { conn, traceparent } => entry(
                &mut entries,
                11,
                conn.0,
                0,
                traceparent.as_deref().unwrap_or_default().as_bytes(),
            ),
        };
        count += 1;
    }
    if output.need_peer_ids {
        flags |= 8;
    }
    buffer.clear();
    for v in [
        0x4d534553,
        generated::ABI_MAJOR,
        generated::DIFF_FORMAT_VERSION,
        diff.words.len() as u32,
        diff.strings.len() as u32,
        count,
    ] {
        buffer.extend(v.to_le_bytes());
    }
    for word in diff.words {
        buffer.extend(word.to_le_bytes());
    }
    buffer.extend(diff.strings);
    pad(buffer);
    buffer.extend(entries);
    Ok(flags)
}
