//! Copies domain output into owned typed native records.
use crate::*;
pub(crate) fn output(out: &SessionOutput) -> Result<FfiOutput, FfiSessionError> {
    let view = out
        .view
        .iter()
        .map(|effect| {
            Ok(match effect {
                ViewEffect::Initialize(InitialView::Editor { diff, state }) => {
                    FfiViewEffect::Initialize {
                        diff: diff.clone(),
                        root: state.root.clone(),
                    }
                }
                ViewEffect::Initialize(InitialView::Generic(values)) => {
                    FfiViewEffect::InitializeDoc {
                        values: values
                            .iter()
                            .map(|(path, value)| FfiObservedValue {
                                path: path.clone(),
                                value: value.clone(),
                            })
                            .collect(),
                    }
                }
                ViewEffect::Diff(diff) => FfiViewEffect::Diff { diff: diff.clone() },
                ViewEffect::Status(status) => FfiViewEffect::Status {
                    status: status.clone(),
                },
                ViewEffect::CommitTags(tags) => FfiViewEffect::CommitTags { tags: tags.clone() },
                ViewEffect::Cursors(peers) => FfiViewEffect::Cursors {
                    peers: peers
                        .iter()
                        .map(|peer| FfiEditorPeerSelection {
                            key: peer.key.clone(),
                            color: peer.color.clone(),
                            selection: peer.selection.clone(),
                        })
                        .collect(),
                },
                ViewEffect::EndComposition => FfiViewEffect::EndComposition,
                ViewEffect::Error(error) => FfiViewEffect::Error {
                    message: error.to_string(),
                },
                ViewEffect::Presence(peers) => FfiViewEffect::Presence {
                    peers: peers
                        .iter()
                        .map(|p| PeerPresence {
                            key: p.key.clone(),
                            value: p.value.clone(),
                        })
                        .collect(),
                },
                ViewEffect::Reply { request, reply } => FfiViewEffect::Reply {
                    request: *request,
                    reply: match reply {
                        Reply::Stopped => FfiReply::Stopped,
                        Reply::Flush(result) => FfiReply::Flush {
                            result: result.clone(),
                        },
                        Reply::Comment(result) => FfiReply::Comment {
                            result: result.clone(),
                        },
                        Reply::Snapshot(Ok(bytes)) => FfiReply::Snapshot {
                            bytes: bytes.clone(),
                        },
                        Reply::Snapshot(Err(error)) => FfiReply::SnapshotFailed {
                            error: error.clone(),
                        },
                    },
                },
                ViewEffect::Editor(effect) => match effect {
                    Effect::SetViewSelection {
                        selection,
                        format,
                        style,
                    } => FfiViewEffect::SetSelection {
                        selection: selection.clone(),
                        format: *format,
                        style: style.to_string(),
                    },
                    Effect::ScrollIntoView(key) => FfiViewEffect::ScrollIntoView { key: *key },
                    Effect::DecoratorsChanged(keys) => {
                        FfiViewEffect::Decorators { keys: keys.clone() }
                    }
                    Effect::HistoryState(availability) => FfiViewEffect::HistoryState {
                        availability: *availability,
                    },
                    Effect::TextContentChanged => FfiViewEffect::TextContentChanged,
                    Effect::SelectionChange => FfiViewEffect::SelectionChange,
                    Effect::PreventDefault => FfiViewEffect::PreventDefault,
                    Effect::ScheduleRemoveEmptyText { key, delay_ms } => {
                        FfiViewEffect::ScheduleRemoveEmptyText {
                            key: *key,
                            delay_ms: *delay_ms,
                        }
                    }
                    Effect::RemoteNodesCreated(nodes) => FfiViewEffect::RemoteNodesCreated {
                        nodes: nodes
                            .iter()
                            .map(|(local, key)| FfiCreatedNode {
                                local: local.0,
                                key: *key,
                            })
                            .collect(),
                    },
                    Effect::PluginEvent(event) => FfiViewEffect::PluginEvent {
                        name: event.name().into(),
                        payload: macro_document_model::surface::event_payload(event)
                            .map_err(invalid)?,
                    },
                    Effect::FollowUpFailed {
                        plugin,
                        kind,
                        message,
                    } => FfiViewEffect::FollowUpFailed {
                        plugin: (*plugin).into(),
                        kind: (*kind).into(),
                        message: message.to_string(),
                    },
                },
                ViewEffect::DocChanged(changes) => FfiViewEffect::DocChanged {
                    changes: changes
                        .iter()
                        .map(|change| match change {
                            DocEvent::Map { path, updated } => FfiDocEvent::Map {
                                path: path.clone(),
                                updated: updated
                                    .iter()
                                    .map(|(key, value)| FfiMapChange {
                                        key: key.clone(),
                                        value: value.clone(),
                                    })
                                    .collect(),
                            },
                            DocEvent::List { path, delta } => FfiDocEvent::ListChanged {
                                path: path.clone(),
                                delta: delta
                                    .iter()
                                    .map(|d| match d {
                                        ListDelta::Retain(count) => FfiListDelta::Retain {
                                            count: *count as u64,
                                        },
                                        ListDelta::Delete(count) => FfiListDelta::Delete {
                                            count: *count as u64,
                                        },
                                        ListDelta::Insert { values, is_move } => {
                                            FfiListDelta::Insert {
                                                values: values.clone(),
                                                is_move: *is_move,
                                            }
                                        }
                                    })
                                    .collect(),
                            },
                            DocEvent::Text { path, delta } => FfiDocEvent::Text {
                                path: path.clone(),
                                delta: delta
                                    .iter()
                                    .map(|d| match d {
                                        loro::TextDelta::Retain { retain, attributes } => {
                                            FfiTextDelta::Retain {
                                                count: *retain as u64,
                                                attributes: attributes.as_ref().map(|a| {
                                                    a.iter()
                                                        .map(|(k, v)| (k.clone(), v.clone()))
                                                        .collect()
                                                }),
                                            }
                                        }
                                        loro::TextDelta::Insert { insert, attributes } => {
                                            FfiTextDelta::Insert {
                                                text: insert.clone(),
                                                attributes: attributes.as_ref().map(|a| {
                                                    a.iter()
                                                        .map(|(k, v)| (k.clone(), v.clone()))
                                                        .collect()
                                                }),
                                            }
                                        }
                                        loro::TextDelta::Delete { delete } => {
                                            FfiTextDelta::Delete {
                                                count: *delete as u64,
                                            }
                                        }
                                    })
                                    .collect(),
                            },
                        })
                        .collect(),
                },
            })
        })
        .collect::<Result<_, FfiSessionError>>()?;
    let io = out
        .io
        .iter()
        .map(|effect| {
            Ok(match effect {
                IoEffect::FetchToken { attempt, doc } => FfiIoEffect::FetchToken {
                    attempt: *attempt,
                    doc: doc.clone(),
                },
                IoEffect::SocketConnect {
                    conn,
                    doc,
                    token,
                    traceparent,
                } => FfiIoEffect::SocketConnect {
                    conn: *conn,
                    doc: doc.clone(),
                    token: token.expose_secret().into(),
                    traceparent: traceparent.clone(),
                },
                IoEffect::SocketSend { conn, frame } => FfiIoEffect::SocketSend {
                    conn: *conn,
                    frame: frame.clone(),
                },
                IoEffect::SocketPing { conn } => FfiIoEffect::SocketPing { conn: *conn },
                IoEffect::SocketClose { conn, code, reason } => FfiIoEffect::SocketClose {
                    conn: *conn,
                    code: *code,
                    reason: reason.clone(),
                },
                IoEffect::Storage { id, op } => FfiIoEffect::Storage {
                    op: *id,
                    op_body: op.clone(),
                },
                IoEffect::Telemetry(record) => FfiIoEffect::Telemetry {
                    record: FfiTelemetry {
                        span: record.span.0,
                        kind: match record.kind {
                            TelemetryKind::Start { name } => {
                                FfiTelemetryKind::Start { name: name.into() }
                            }
                            TelemetryKind::Event { name } => {
                                FfiTelemetryKind::Event { name: name.into() }
                            }
                            TelemetryKind::End { outcome, error } => FfiTelemetryKind::End {
                                outcome: outcome.into(),
                                error,
                            },
                        },
                        attrs: record
                            .attrs
                            .iter()
                            .map(|(key, value)| FfiAttribute {
                                key: (*key).into(),
                                value: value.clone(),
                            })
                            .collect(),
                    },
                },
                _ => {
                    return Err(invalid(
                        "native sessions require direct/no transport and no chatter",
                    ));
                }
            })
        })
        .collect::<Result<_, FfiSessionError>>()?;
    Ok(FfiOutput {
        view,
        io,
        wake_at_ms: out.wake_at.map(|v| v.0),
        need_peer_ids: out.need_peer_ids,
    })
}
