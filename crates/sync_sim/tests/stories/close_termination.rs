use super::*;

/// covers: S7:74; revoked, read-only and mid-start Close must terminate.
#[test]
fn close_terminates_for_each_access_start_phase_and_revoked_editor() {
    for editor in [false, true] {
        for kind in [ClientKind::Tab, ClientKind::AiWorker] {
            for access in [Access::Edit, Access::Read, Access::CommentOnly] {
                for running in [false, true] {
                    for revoked in [false, true] {
                        // A live AI host requires initialized Edit access for its
                        // pre-close flush. Tabs and terminal AI cores do not.
                        if kind == ClientKind::AiWorker
                            && !revoked
                            && (!running || access != Access::Edit)
                        {
                            continue;
                        }
                        let mut config = if editor {
                            SimConfig::editor(811)
                        } else {
                            SimConfig::calm(811)
                        };
                        config.session.transport = TransportKind::Direct;
                        let mut script = vec![Step::Open(OpenSpec {
                            access,
                            kind,
                            ..OpenSpec::form("a", "one")
                        })];
                        if running {
                            script.push(Step::Run(Millis(500)));
                        }
                        if revoked {
                            script.push(Step::SignIn {
                                profile: ProfileName("one".into()),
                                user: "other-user".into(),
                            });
                        }
                        script.extend([
                            Step::Close {
                                client: ClientName("a".into()),
                            },
                            Step::Settle,
                        ]);
                        let outcome = verify(config, &script);
                        assert!(
                            outcome
                                .events
                                .iter()
                                .any(|event| matches!(event.fact, Fact::CloseRequested { .. }))
                        );

                        let mut missing = outcome.clone();
                        missing
                            .events
                            .retain(|event| !matches!(event.fact, Fact::CloseAcknowledged { .. }));
                        assert!(invariants::every_close_terminates(&missing).is_err());
                        let mut wrong_request = outcome.clone();
                        for event in &mut wrong_request.events {
                            if let Fact::CloseAcknowledged { request, .. } = &mut event.fact {
                                *request = u32::MAX;
                            }
                        }
                        assert!(invariants::every_close_terminates(&wrong_request).is_err());
                        let mut wrong_session = outcome.clone();
                        for event in &mut wrong_session.events {
                            if let Fact::CloseAcknowledged { session, .. } = &mut event.fact {
                                *session = doc_sync_core::SessionId(uuid_value::Uuid::from_u128(0));
                            }
                        }
                        assert!(invariants::every_close_terminates(&wrong_session).is_err());
                        let mut late = outcome.clone();
                        for event in &mut late.events {
                            if let Fact::CloseRequested { deadline, .. } = &mut event.fact {
                                *deadline = 0;
                            }
                        }
                        // At virtual time zero, a synchronous Close can legitimately
                        // meet a zero deadline. Running cases must reject it.
                        if running {
                            assert!(invariants::every_close_terminates(&late).is_err());
                        }
                        let mut unfinished = outcome.clone();
                        unfinished
                            .events
                            .retain(|event| !matches!(event.fact, Fact::Closed { .. }));
                        assert!(invariants::every_close_terminates(&unfinished).is_err());
                    }
                }
            }
        }
    }
}

/// covers: S7:74; Init cancellation does not need Start, authorization or a view.
#[test]
fn close_before_start_terminates_for_every_access_and_real_surface() {
    for editor in [false, true] {
        for kind in [ClientKind::Tab, ClientKind::AiWorker] {
            for access in [Access::Edit, Access::Read, Access::CommentOnly] {
                let config = if editor {
                    SimConfig::editor(812)
                } else {
                    SimConfig::calm(812)
                };
                let outcome = verify(
                    config,
                    &[
                        Step::Create(OpenSpec {
                            access,
                            kind,
                            ..OpenSpec::form("cancelled", "one")
                        }),
                        Step::Close {
                            client: ClientName("cancelled".into()),
                        },
                        Step::Settle,
                    ],
                );
                assert!(
                    outcome
                        .events
                        .iter()
                        .any(|event| matches!(event.fact, Fact::CloseRequested { .. }))
                );
                let stop = outcome
                    .events
                    .iter()
                    .position(|event| matches!(event.fact, Fact::Closed { .. }))
                    .unwrap();
                assert!(outcome.events[..stop].iter().all(|event| !matches!(
                    event.fact,
                    Fact::TokenRequested { .. } | Fact::WalAppendIssued { .. }
                )));
            }
        }
    }
}
