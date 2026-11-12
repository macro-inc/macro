use std::sync::{Arc, Mutex};

use harnessd_protocol::ErrorKind;

use super::fakes::{FakeHarnessd, FakeLocks, recording_harnesses};
use super::*;

const HARNESS: HarnessId = HarnessId::TEST_A;

fn computer() -> ComputerId {
    ComputerId::new_from_uuid(uuid::Uuid::from_u128(1))
}

fn signer() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|owner@example.com".to_owned()).unwrap()
}

fn signed_in() -> Response {
    Response::SignedIn {
        agent: AgentProvider::Claude,
        claude: Some(ClaudeAccount {
            credential_id: "sha256:0123456789abcdef0123456789abcdef".to_owned(),
            expires_at: Some("2027-11-11T22:00:00Z".parse().unwrap()),
        }),
    }
}

fn claude_sign_in(signed_in_by: Option<MacroUserIdStr<'static>>) -> AccountLoginChange {
    AccountLoginChange::SignedIn {
        provider: AgentProvider::Claude,
        account: ProviderAccountIdentity {
            external_account_id: "sha256:0123456789abcdef0123456789abcdef".to_owned(),
        },
        expires_at: Some("2027-11-11T22:00:00Z".parse().unwrap()),
        signed_in_by,
    }
}

#[tokio::test]
async fn a_completed_sign_in_is_recorded_with_its_signer() {
    let changes = Arc::new(Mutex::new(Vec::new()));
    let transport = Arc::new(FakeHarnessd::new(|_| signed_in()));
    let harnessd = Harnessd::new(
        transport.clone(),
        Arc::new(FakeLocks::default()),
        Arc::new(recording_harnesses(Arc::clone(&changes))),
    );

    let answer = harnessd
        .run(
            HARNESS,
            computer(),
            Request::SignInComplete {
                agent: AgentProvider::Claude,
                code: "abc#def".to_owned(),
            },
            Some(signer()),
        )
        .await
        .unwrap();

    assert_eq!(answer, signed_in());
    // The answer is the status: harnessd is asked nothing more.
    assert_eq!(transport.requests.lock().unwrap().len(), 1);
    assert_eq!(
        *changes.lock().unwrap(),
        vec![(HARNESS, claude_sign_in(Some(signer())))]
    );
}

#[tokio::test]
async fn a_started_sign_in_records_the_status_harnessd_reports_after_it() {
    let changes = Arc::new(Mutex::new(Vec::new()));
    let transport = Arc::new(FakeHarnessd::new(|request| match request {
        Request::SignInStart { .. } => Response::SignInStarted {
            agent: AgentProvider::Claude,
            url: "https://claude.com/cai/oauth/authorize?code=true".to_owned(),
        },
        _ => Response::Pending {
            agent: AgentProvider::Claude,
        },
    }));
    let harnessd = Harnessd::new(
        transport.clone(),
        Arc::new(FakeLocks::default()),
        Arc::new(recording_harnesses(Arc::clone(&changes))),
    );

    harnessd
        .run(
            HARNESS,
            computer(),
            Request::SignInStart {
                agent: AgentProvider::Claude,
            },
            Some(signer()),
        )
        .await
        .unwrap();

    assert_eq!(
        *transport.requests.lock().unwrap(),
        vec![
            Request::SignInStart {
                agent: AgentProvider::Claude
            },
            Request::Status {
                agent: AgentProvider::Claude
            },
        ]
    );
    // Nothing is signed in while the sign-in waits.
    assert_eq!(
        *changes.lock().unwrap(),
        vec![(
            HARNESS,
            AccountLoginChange::SignedOut {
                provider: AgentProvider::Claude
            }
        )]
    );
}

#[tokio::test]
async fn a_status_read_by_the_timer_names_no_signer() {
    let changes = Arc::new(Mutex::new(Vec::new()));
    let harnessd = Harnessd::new(
        Arc::new(FakeHarnessd::new(|_| signed_in())),
        Arc::new(FakeLocks::default()),
        Arc::new(recording_harnesses(Arc::clone(&changes))),
    );

    harnessd
        .refresh(HARNESS, computer(), AgentProvider::Claude)
        .await
        .unwrap();

    assert_eq!(
        *changes.lock().unwrap(),
        vec![(HARNESS, claude_sign_in(None))]
    );
}

#[tokio::test]
async fn a_failed_command_records_the_status_after_it() {
    let changes = Arc::new(Mutex::new(Vec::new()));
    let harnessd = Harnessd::new(
        Arc::new(FakeHarnessd::new(|request| match request {
            Request::SignInComplete { .. } => Response::Error {
                agent: Some(AgentProvider::Claude),
                kind: ErrorKind::InvalidCode,
            },
            _ => Response::SignedOut {
                agent: AgentProvider::Claude,
            },
        })),
        Arc::new(FakeLocks::default()),
        Arc::new(recording_harnesses(Arc::clone(&changes))),
    );

    let answer = harnessd
        .run(
            HARNESS,
            computer(),
            Request::SignInComplete {
                agent: AgentProvider::Claude,
                code: "abc#def".to_owned(),
            },
            Some(signer()),
        )
        .await
        .unwrap();

    assert_eq!(
        answer,
        Response::Error {
            agent: Some(AgentProvider::Claude),
            kind: ErrorKind::InvalidCode,
        }
    );
    assert_eq!(
        *changes.lock().unwrap(),
        vec![(
            HARNESS,
            AccountLoginChange::SignedOut {
                provider: AgentProvider::Claude
            }
        )]
    );
}

#[tokio::test]
async fn a_cancel_reaches_harnessd_while_a_completion_holds_the_lock() {
    let changes = Arc::new(Mutex::new(Vec::new()));
    let transport = Arc::new(
        FakeHarnessd::new(|request| match request {
            Request::SignInComplete { .. } => Response::Error {
                agent: Some(AgentProvider::Claude),
                kind: ErrorKind::Cancelled,
            },
            _ => Response::SignedOut {
                agent: AgentProvider::Claude,
            },
        })
        .holding_complete(),
    );
    let harnessd = Harnessd::new(
        transport.clone(),
        Arc::new(FakeLocks::default()),
        Arc::new(recording_harnesses(Arc::clone(&changes))),
    );

    let completing = tokio::spawn({
        let harnessd = harnessd.clone();
        async move {
            harnessd
                .run(
                    HARNESS,
                    computer(),
                    Request::SignInComplete {
                        agent: AgentProvider::Claude,
                        code: "abc#def".to_owned(),
                    },
                    Some(signer()),
                )
                .await
        }
    });
    transport.complete_started.notified().await;

    // The completion holds the lock until harnessd answers it, which only
    // the cancel makes it do.
    let cancelled = harnessd
        .run(
            HARNESS,
            computer(),
            Request::SignInCancel {
                agent: AgentProvider::Claude,
            },
            None,
        )
        .await
        .unwrap();

    assert_eq!(
        cancelled,
        Response::SignedOut {
            agent: AgentProvider::Claude
        }
    );
    assert_eq!(
        completing.await.unwrap().unwrap(),
        Response::Error {
            agent: Some(AgentProvider::Claude),
            kind: ErrorKind::Cancelled,
        }
    );
}

#[tokio::test]
async fn an_answer_past_the_cap_is_refused_and_the_process_dropped() {
    let endless = hosted_runtimes::domain::ports::GuestProcess::<std::io::Error> {
        stdin: Box::pin(tokio::io::sink()),
        stdout: Box::pin(tokio::io::repeat(b'x')),
        exit: Box::pin(std::future::pending()),
    };

    let answer = exchange(
        endless,
        &Request::Status {
            agent: AgentProvider::Claude,
        },
    )
    .await;

    assert!(matches!(answer, Err(HarnessdError::AnswerTooLarge)));
}

#[tokio::test]
async fn one_answer_line_is_read_back() {
    let process = hosted_runtimes::domain::ports::GuestProcess::<std::io::Error> {
        stdin: Box::pin(tokio::io::sink()),
        stdout: Box::pin(std::io::Cursor::new(
            b"{\"result\":\"signed_out\",\"agent\":\"claude\"}\n".to_vec(),
        )),
        exit: Box::pin(async { Ok(0) }),
    };

    let answer = exchange(
        process,
        &Request::Status {
            agent: AgentProvider::Claude,
        },
    )
    .await
    .unwrap();

    assert_eq!(
        answer,
        Response::SignedOut {
            agent: AgentProvider::Claude
        }
    );
}
