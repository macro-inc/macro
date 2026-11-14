use std::path::PathBuf;

use chrono::{TimeZone, Utc};

use super::*;
use crate::domain::observation::TranscriptEvent;

fn at(minute: u32, second: u32) -> Timestamp {
    Utc.with_ymd_and_hms(2026, 1, 2, 10, minute, second)
        .single()
        .expect("a valid fixed time")
}

fn terminal(address: &str, pid: u32) -> TerminalFact {
    TerminalFact {
        address: address.to_owned(),
        name: "rpc-server".to_owned(),
        parent: Some("t1".to_owned()),
        spawned_by: None,
        cwd: Some(PathBuf::from("/work")),
        state: TerminalState::Live,
        activity: Some(TerminalActivity::Working),
        status_message: None,
        turn: None,
        created: Some(at(0, 0)),
        finished: None,
        exit_code: None,
        finish_reason: None,
        foreground_pid: Some(pid),
        program: Some("claude".to_owned()),
        kind: Some(AgentKind::Builder),
        model: None,
        space: None,
        goal: None,
        waiting: false,
        manager_dir: None,
        macrod_session: None,
        run_id: None,
        tags: Vec::new(),
    }
}

fn transcript(session: &str, subagent: Option<&str>, events: Vec<TranscriptEvent>) -> Fact {
    Fact::Transcript(TranscriptDelta {
        key: TranscriptKey {
            program: TranscriptProgram::Claude,
            session: session.to_owned(),
            subagent: subagent.map(str::to_owned),
        },
        path: PathBuf::from(format!("/t/{session}.jsonl")),
        from_start: false,
        cwd: None,
        branch: Some("feat/x".to_owned()),
        model: Some("claude-opus-5-5".to_owned()),
        title: None,
        events,
    })
}

#[test]
fn terminal_registry_and_transcript_join_into_one_agent() {
    let now = at(5, 0);
    let mut facts = Facts::default();
    facts.apply(
        Observation {
            source: SourceKind::Hc,
            change: Change::Reset(vec![
                Fact::Terminal(Box::new(terminal("t2", 4242))),
                Fact::Terminal(Box::new(TerminalFact {
                    parent: None,
                    ..terminal("t1", 1)
                })),
            ]),
        },
        now,
    );
    facts.apply(
        Observation {
            source: SourceKind::ClaudeRegistry,
            change: Change::Upsert(Fact::ClaudeSession(ClaudeSessionFact {
                pid: 4242,
                session_id: "s-1".to_owned(),
                cwd: None,
                name: None,
                busy: true,
                updated: None,
            })),
        },
        now,
    );
    let events = facts.apply(
        Observation {
            source: SourceKind::ClaudeTranscripts,
            change: Change::Reset(vec![
                transcript(
                    "s-1",
                    None,
                    vec![
                        TranscriptEvent {
                            at: at(4, 0),
                            kind: TranscriptEventKind::ToolStart {
                                id: "a".to_owned(),
                                name: "Edit".to_owned(),
                                gist: Some("store.rs".to_owned()),
                            },
                        },
                        TranscriptEvent {
                            at: at(4, 10),
                            kind: TranscriptEventKind::ToolEnd {
                                id: "a".to_owned(),
                                is_error: true,
                            },
                        },
                        TranscriptEvent {
                            at: at(4, 20),
                            kind: TranscriptEventKind::ToolStart {
                                id: "b".to_owned(),
                                name: "Bash".to_owned(),
                                gist: Some("cargo".to_owned()),
                            },
                        },
                    ],
                ),
                transcript(
                    "s-1",
                    Some("sub"),
                    vec![TranscriptEvent {
                        at: at(4, 30),
                        kind: TranscriptEventKind::TurnEnd,
                    }],
                ),
            ]),
        },
        now,
    );

    assert_eq!(events.len(), 4);
    let built = build_agents(&facts, now);
    assert_eq!(built.agents.len(), 3, "{:?}", built.agents.keys());

    let agent = &built.agents[&AgentId::terminal("t2")];
    assert_eq!(agent.session.as_deref(), Some("s-1"));
    assert_eq!(agent.status, Status::Working);
    assert_eq!(agent.tool_calls, 2);
    assert_eq!(agent.tool_errors, 1);
    assert_eq!(agent.failures, 1);
    assert_eq!(agent.doing.as_deref(), Some("Bash cargo"));
    assert_eq!(agent.cost, Cost::Unpriced);
    assert_eq!(agent.parent, Some(AgentId::terminal("t1")));
    assert_eq!(agent.activity[ACTIVITY_MINUTES - 2], 2);
    assert!(agent.sources.contains(SourceKind::Hc));
    assert!(agent.sources.contains(SourceKind::ClaudeRegistry));
    assert!(agent.sources.contains(SourceKind::ClaudeTranscripts));

    let subagent = &built.agents[&AgentId::claude_subagent("s-1", "sub")];
    assert_eq!(subagent.parent, Some(AgentId::terminal("t2")));
    assert_eq!(
        built.agents[&AgentId::terminal("t2")].children,
        vec![AgentId::claude_subagent("s-1", "sub")]
    );
    assert_eq!(
        built.agents[&AgentId::terminal("t1")].children,
        vec![AgentId::terminal("t2")]
    );
}

#[test]
fn reset_drops_only_the_resetting_sources_facts() {
    let now = at(5, 0);
    let mut facts = Facts::default();
    facts.apply(
        Observation {
            source: SourceKind::Hc,
            change: Change::Upsert(Fact::Terminal(Box::new(terminal("t2", 7)))),
        },
        now,
    );
    facts.apply(
        Observation {
            source: SourceKind::ClaudeTranscripts,
            change: Change::Upsert(transcript("s-9", None, Vec::new())),
        },
        now,
    );
    facts.apply(
        Observation {
            source: SourceKind::Hc,
            change: Change::Reset(Vec::new()),
        },
        now,
    );

    let built = build_agents(&facts, now);
    let ids: Vec<&AgentId> = built.agents.keys().collect();
    assert_eq!(ids, vec![&AgentId::claude_session("s-9")]);
}

#[test]
fn finished_terminal_status_follows_reason_then_exit_code() {
    let finished = |exit_code, finish_reason| TerminalFact {
        state: TerminalState::Finished,
        exit_code,
        finish_reason,
        ..terminal("t", 1)
    };

    assert_eq!(
        terminal_status(&finished(Some(0), Some(FinishReason::Exited))).0,
        Status::Done
    );
    assert_eq!(
        terminal_status(&finished(Some(1), Some(FinishReason::Exited))).0,
        Status::Failed
    );
    assert_eq!(
        terminal_status(&finished(Some(0), Some(FinishReason::Killed))).0,
        Status::Stopped
    );
}
