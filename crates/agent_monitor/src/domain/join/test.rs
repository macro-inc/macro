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

fn observe(facts: &mut Facts, source: SourceKind, change: Change, now: Timestamp) {
    facts.apply(Observation { source, change }, now);
}

fn registry(pid: u32, session: &str, busy: bool) -> Fact {
    Fact::ClaudeSession(ClaudeSessionFact {
        pid,
        session_id: session.to_owned(),
        cwd: Some(PathBuf::from("/work")),
        name: Some("plain".to_owned()),
        busy,
        updated: None,
    })
}

fn usage(at: Timestamp, input: u64, output: u64) -> TranscriptEvent {
    TranscriptEvent {
        at,
        kind: TranscriptEventKind::Usage(Tokens {
            input,
            output,
            ..Tokens::default()
        }),
    }
}

fn reported(at: Timestamp, usd: f64) -> TranscriptEvent {
    TranscriptEvent {
        at,
        kind: TranscriptEventKind::Cost(Cost::Known(usd)),
    }
}

fn with_model(fact: Fact, model: Option<&str>) -> Fact {
    match fact {
        Fact::Transcript(delta) => Fact::Transcript(TranscriptDelta {
            model: model.map(str::to_owned),
            ..delta
        }),
        other => other,
    }
}

fn codex_rollout(session: &str, cwd: &str, events: Vec<TranscriptEvent>) -> Fact {
    Fact::Transcript(TranscriptDelta {
        key: TranscriptKey {
            program: TranscriptProgram::Codex,
            session: session.to_owned(),
            subagent: None,
        },
        path: PathBuf::from(format!("/codex/{session}.jsonl")),
        from_start: true,
        cwd: Some(PathBuf::from(cwd)),
        branch: None,
        model: Some("gpt-6-sol".to_owned()),
        title: None,
        events,
    })
}

fn assert_usd(cost: Cost, expected: f64) {
    let usd = cost.usd().expect("a dollar amount");
    assert!(
        (usd - expected).abs() < 1e-9,
        "expected {expected}, got {cost:?}"
    );
}

#[test]
fn a_registry_entry_without_a_terminal_joins_its_transcript_into_one_agent() {
    let now = at(5, 0);
    let mut facts = Facts::default();
    observe(
        &mut facts,
        SourceKind::ClaudeRegistry,
        Change::Reset(vec![registry(900, "s-2", true)]),
        now,
    );
    observe(
        &mut facts,
        SourceKind::ClaudeTranscripts,
        Change::Upsert(transcript("s-2", None, vec![usage(at(1, 0), 10, 10)])),
        now,
    );

    let built = build_agents(&facts, now);

    assert_eq!(built.agents.len(), 1, "{:?}", built.agents.keys());
    let agent = &built.agents[&AgentId::claude_session("s-2")];
    assert_eq!(agent.name, "plain");
    assert_eq!(agent.status, Status::Working);
    assert_eq!(agent.pid, Some(900));
    assert_eq!(agent.transcript, Some(PathBuf::from("/t/s-2.jsonl")));
    assert_eq!(
        built.owners[&FactKey::ClaudeSession(900)],
        AgentId::claude_session("s-2")
    );
}

#[test]
fn a_transcript_with_no_process_is_working_while_written_then_done() {
    let mut facts = Facts::default();
    observe(
        &mut facts,
        SourceKind::ClaudeRegistry,
        Change::Reset(Vec::new()),
        at(5, 0),
    );
    observe(
        &mut facts,
        SourceKind::ClaudeTranscripts,
        Change::Upsert(transcript("s-3", None, vec![usage(at(4, 0), 1, 1)])),
        at(5, 0),
    );

    let fresh = build_agents(&facts, at(5, 0));
    let stale = build_agents(&facts, at(9, 0));

    let id = AgentId::claude_session("s-3");
    assert_eq!(fresh.agents[&id].status, Status::Working);
    assert_eq!(fresh.agents[&id].ended, None);
    assert_eq!(stale.agents[&id].status, Status::Done);
    assert_eq!(stale.agents[&id].ended, Some(at(4, 0)));
}

#[test]
fn without_a_registry_a_quiet_transcript_is_idle_not_done() {
    let mut facts = Facts::default();
    observe(
        &mut facts,
        SourceKind::ClaudeTranscripts,
        Change::Upsert(transcript("s-4", None, vec![usage(at(1, 0), 1, 1)])),
        at(5, 0),
    );

    let built = build_agents(&facts, at(30, 0));

    assert_eq!(
        built.agents[&AgentId::claude_session("s-4")].status,
        Status::Idle
    );
}

#[test]
fn a_subagent_is_working_while_its_transcript_is_written_then_done() {
    let mut facts = Facts::default();
    observe(
        &mut facts,
        SourceKind::ClaudeTranscripts,
        Change::Reset(vec![
            transcript("s-5", None, Vec::new()),
            transcript(
                "s-5",
                Some("a1"),
                vec![TranscriptEvent {
                    at: at(4, 50),
                    kind: TranscriptEventKind::TurnStart,
                }],
            ),
        ]),
        at(5, 0),
    );

    let id = AgentId::claude_subagent("s-5", "a1");
    let fresh = build_agents(&facts, at(5, 0));
    assert_eq!(fresh.agents[&id].status, Status::Working);
    assert_eq!(fresh.agents[&id].kind, AgentKind::Subagent);
    assert_eq!(
        fresh.agents[&id].parent,
        Some(AgentId::claude_session("s-5"))
    );

    let stale = build_agents(&facts, at(20, 0));
    assert_eq!(stale.agents[&id].status, Status::Done);
}

#[test]
fn a_terminal_without_an_hc_parent_takes_the_terminal_that_spawned_it() {
    let now = at(5, 0);
    let mut facts = Facts::default();
    observe(
        &mut facts,
        SourceKind::Hc,
        Change::Reset(vec![
            Fact::Terminal(Box::new(TerminalFact {
                parent: None,
                ..terminal("t1", 1)
            })),
            Fact::Terminal(Box::new(TerminalFact {
                parent: None,
                spawned_by: Some("t1".to_owned()),
                ..terminal("t2", 2)
            })),
            // A spawner that is gone is no parent.
            Fact::Terminal(Box::new(TerminalFact {
                parent: None,
                spawned_by: Some("t-gone".to_owned()),
                ..terminal("t3", 3)
            })),
        ]),
        now,
    );

    let built = build_agents(&facts, now);

    assert_eq!(
        built.agents[&AgentId::terminal("t2")].parent,
        Some(AgentId::terminal("t1"))
    );
    assert_eq!(built.agents[&AgentId::terminal("t3")].parent, None);
}

#[test]
fn a_manager_directory_makes_its_terminal_a_manager_with_its_goal_and_state() {
    let now = at(5, 0);
    let mut facts = Facts::default();
    observe(
        &mut facts,
        SourceKind::Hc,
        Change::Upsert(Fact::Terminal(Box::new(TerminalFact {
            kind: None,
            activity: Some(TerminalActivity::Idle),
            manager_dir: Some(PathBuf::from("/m/t1-1")),
            ..terminal("t1", 1)
        }))),
        now,
    );
    observe(
        &mut facts,
        SourceKind::Manager,
        Change::Reset(vec![Fact::Manager(ManagerFact {
            dir: PathBuf::from("/m/t1-1"),
            goal: Some("Ship the widget".to_owned()),
            state: Some("reviewing".to_owned()),
            reviews: 2,
            last_verdict: Some("fail".to_owned()),
        })]),
        now,
    );

    let built = build_agents(&facts, now);

    let agent = &built.agents[&AgentId::terminal("t1")];
    assert_eq!(agent.kind, AgentKind::Manager);
    assert_eq!(agent.task.as_deref(), Some("Ship the widget"));
    assert_eq!(agent.status_detail.as_deref(), Some("reviewing"));
    assert!(agent.sources.contains(SourceKind::Manager));
    assert_eq!(built.agents.len(), 1);
}

#[test]
fn a_macrod_session_marks_the_agent_holding_its_native_session_or_transcript() {
    let now = at(5, 0);
    let mut facts = Facts::default();
    observe(
        &mut facts,
        SourceKind::Hc,
        Change::Upsert(Fact::Terminal(Box::new(TerminalFact {
            kind: None,
            ..terminal("t7", 700)
        }))),
        now,
    );
    observe(
        &mut facts,
        SourceKind::ClaudeRegistry,
        Change::Reset(vec![registry(700, "s-7", false)]),
        now,
    );
    observe(
        &mut facts,
        SourceKind::ClaudeTranscripts,
        Change::Reset(vec![transcript("s-8", None, vec![usage(at(4, 59), 1, 1)])]),
        now,
    );
    let macrod = |id: &str, native: Option<&str>, transcript: Option<&str>| {
        Fact::MacrodSession(MacrodSessionFact {
            id: id.to_owned(),
            harness: "h-1".to_owned(),
            cwd: None,
            model: None,
            native_id: native.map(str::to_owned),
            transcript: transcript.map(PathBuf::from),
            started: Some(at(0, 0)),
        })
    };
    observe(
        &mut facts,
        SourceKind::Macrod,
        Change::Reset(vec![
            macrod("m-1", Some("s-7"), None),
            macrod("m-2", None, Some("/t/s-8.jsonl")),
            macrod("m-3", Some("s-old"), Some("/t/s-old.jsonl")),
        ]),
        now,
    );

    let built = build_agents(&facts, now);

    let by_native = &built.agents[&AgentId::terminal("t7")];
    assert_eq!(by_native.kind, AgentKind::MacrodSession);
    assert!(by_native.sources.contains(SourceKind::Macrod));
    let by_transcript = &built.agents[&AgentId::claude_session("s-8")];
    assert_eq!(by_transcript.kind, AgentKind::MacrodSession);
    // A session record alone is history, not an agent.
    assert_eq!(built.agents.len(), 2, "{:?}", built.agents.keys());
    assert!(
        !built
            .owners
            .contains_key(&FactKey::MacrodSession("m-3".to_owned()))
    );
}

#[test]
fn a_run_record_joins_its_terminal_by_name_or_label_and_otherwise_stands_alone() {
    let now = at(5, 0);
    let mut facts = Facts::default();
    observe(
        &mut facts,
        SourceKind::Hc,
        Change::Reset(vec![
            Fact::Terminal(Box::new(TerminalFact {
                kind: None,
                name: "run-terminal".to_owned(),
                ..terminal("t1", 1)
            })),
            Fact::Terminal(Box::new(TerminalFact {
                kind: None,
                run_id: Some("r-2".to_owned()),
                ..terminal("t2", 2)
            })),
        ]),
        now,
    );
    let run = |id: &str, terminal: Option<&str>, status: &str, cost: Option<f64>| {
        Fact::RunRecord(RunRecordFact {
            id: id.to_owned(),
            task: Some("Tidy the docs".to_owned()),
            label: Some(format!("label {id}")),
            status: Some(status.to_owned()),
            started: Some(at(1, 0)),
            pid: Some(5),
            terminal: terminal.map(str::to_owned),
            cost: cost.map(Cost::Known),
        })
    };
    observe(
        &mut facts,
        SourceKind::RunRecord,
        Change::Reset(vec![
            run("r-1", Some("run-terminal"), "running", Some(2.5)),
            run("r-2", None, "running", None),
            run("r-3", Some("t-gone"), "failed", Some(0.5)),
        ]),
        now,
    );

    let built = build_agents(&facts, now);

    let by_name = &built.agents[&AgentId::terminal("t1")];
    assert_eq!(by_name.kind, AgentKind::WorkRun);
    assert_eq!(by_name.task.as_deref(), Some("Tidy the docs"));
    assert_eq!(by_name.cost, Cost::Known(2.5));
    assert_eq!(
        built.agents[&AgentId::terminal("t2")].kind,
        AgentKind::WorkRun
    );

    let alone = &built.agents[&AgentId::run("r-3")];
    assert_eq!(alone.kind, AgentKind::WorkRun);
    assert_eq!(alone.name, "label r-3");
    assert_eq!(alone.status, Status::Failed);
    assert_eq!(alone.cost, Cost::Known(0.5));
    assert_eq!(built.agents.len(), 3);
}

#[test]
fn a_codex_rollout_joins_the_codex_terminal_in_its_directory_started_before_it() {
    let now = at(5, 0);
    let mut facts = Facts::default();
    let codex = |address: &str, cwd: &str, created: Timestamp| {
        Fact::Terminal(Box::new(TerminalFact {
            kind: None,
            program: Some("codex".to_owned()),
            cwd: Some(PathBuf::from(cwd)),
            created: Some(created),
            ..terminal(address, 1)
        }))
    };
    observe(
        &mut facts,
        SourceKind::Hc,
        Change::Reset(vec![
            codex("t-old", "/w/a", at(0, 0)),
            codex("t-new", "/w/a", at(2, 0)),
            codex("t-later", "/w/a", at(4, 0)),
        ]),
        now,
    );
    observe(
        &mut facts,
        SourceKind::Codex,
        Change::Reset(vec![
            codex_rollout("c-1", "/w/a", vec![usage(at(2, 30), 1, 1)]),
            codex_rollout("c-2", "/w/b", vec![usage(at(2, 30), 1, 1)]),
        ]),
        now,
    );

    let built = build_agents(&facts, now);

    assert_eq!(
        built.owners[&FactKey::Transcript(TranscriptKey {
            program: TranscriptProgram::Codex,
            session: "c-1".to_owned(),
            subagent: None,
        })],
        AgentId::terminal("t-new")
    );
    assert_eq!(
        built.agents[&AgentId::terminal("t-new")].session.as_deref(),
        Some("c-1")
    );
    let unjoined = &built.agents[&AgentId::codex_session("c-2")];
    assert_eq!(unjoined.program.as_deref(), Some("codex"));
}

#[test]
fn usage_is_estimated_at_its_model_and_an_unknown_model_is_unpriced_never_free() {
    let now = at(5, 0);
    let mut facts = Facts::default();
    observe(
        &mut facts,
        SourceKind::ClaudeTranscripts,
        Change::Reset(vec![
            transcript("s-a", None, vec![usage(at(1, 0), 1_000_000, 0)]),
            with_model(
                transcript("s-a", None, vec![usage(at(2, 0), 0, 1_000_000)]),
                Some("claude-haiku-4-5"),
            ),
            with_model(
                transcript("s-b", None, vec![usage(at(1, 0), 1_000, 1_000)]),
                Some("some-future-model"),
            ),
            with_model(transcript("s-c", None, Vec::new()), None),
        ]),
        now,
    );

    let built = build_agents(&facts, now);

    // $4 of Opus 5.5 input plus $5 of Haiku 4.5 output.
    let priced = built.agents[&AgentId::claude_session("s-a")].cost;
    assert!(matches!(priced, Cost::Estimated(_)), "{priced:?}");
    assert_usd(priced, 9.0);
    assert_eq!(
        built.agents[&AgentId::claude_session("s-b")].cost,
        Cost::Unpriced
    );
    assert_eq!(
        built.agents[&AgentId::claude_session("s-c")].cost,
        Cost::Unpriced
    );
}

#[test]
fn a_reported_total_replaces_the_estimate_and_rows_add_up_to_it() {
    let now = at(5, 0);
    let mut facts = Facts::default();
    observe(
        &mut facts,
        SourceKind::ClaudeTranscripts,
        Change::Reset(vec![
            transcript(
                "s-r",
                None,
                vec![usage(at(1, 0), 1_000_000, 0), reported(at(3, 0), 10.0)],
            ),
            transcript("s-r", Some("sub"), vec![usage(at(2, 0), 500_000, 0)]),
        ]),
        now,
    );

    let built = build_agents(&facts, now);

    let main = built.agents[&AgentId::claude_session("s-r")].cost;
    let subagent = built.agents[&AgentId::claude_subagent("s-r", "sub")].cost;
    assert_usd(subagent, 2.0);
    assert_usd(main, 8.0);
    assert!(matches!(main, Cost::Estimated(_)), "{main:?}");

    // Without subagents the reported total stands as known.
    let mut alone = Facts::default();
    observe(
        &mut alone,
        SourceKind::ClaudeTranscripts,
        Change::Reset(vec![transcript(
            "s-k",
            None,
            vec![usage(at(1, 0), 1_000_000, 0), reported(at(3, 0), 10.0)],
        )]),
        now,
    );
    assert_eq!(
        build_agents(&alone, now).agents[&AgentId::claude_session("s-k")].cost,
        Cost::Known(10.0)
    );
}

#[test]
fn a_reported_estimate_does_not_become_a_known_cost() {
    let now = at(10, 0);
    let mut facts = Facts::default();
    observe(
        &mut facts,
        SourceKind::ClaudeTranscripts,
        Change::Reset(vec![transcript(
            "s-e",
            None,
            vec![
                usage(at(1, 0), 1_000_000, 0),
                TranscriptEvent {
                    at: at(2, 0),
                    kind: TranscriptEventKind::Cost(Cost::Estimated(99.0)),
                },
            ],
        )]),
        now,
    );

    let cost = build_agents(&facts, now).agents[&AgentId::claude_session("s-e")].cost;
    assert!(matches!(cost, Cost::Estimated(_)), "{cost:?}");
}

#[test]
fn spend_per_minute_follows_usage_and_sums_to_the_reported_total() {
    let now = at(10, 0);
    let mut facts = Facts::default();
    observe(
        &mut facts,
        SourceKind::ClaudeTranscripts,
        Change::Reset(vec![
            // $4 and $2 estimated, $12 reported: every minute scales by two.
            transcript(
                "s-m",
                None,
                vec![usage(at(1, 0), 1_000_000, 0), reported(at(3, 0), 12.0)],
            ),
            transcript("s-m", Some("sub"), vec![usage(at(2, 0), 500_000, 0)]),
            // A reported total with no priced usage lands where it was written.
            with_model(
                transcript(
                    "s-u",
                    None,
                    vec![usage(at(4, 0), 1, 1), reported(at(5, 0), 3.0)],
                ),
                Some("some-future-model"),
            ),
        ]),
        now,
    );

    let counts = minute_counts(&facts, now);

    assert_usd(Cost::Estimated(counts[&at(1, 0)].cost_usd), 8.0);
    assert_usd(Cost::Estimated(counts[&at(2, 0)].cost_usd), 4.0);
    assert_usd(Cost::Estimated(counts[&at(5, 0)].cost_usd), 3.0);
    let total: f64 = counts.values().map(|minute| minute.cost_usd).sum();
    assert_usd(Cost::Estimated(total), 15.0);
}

#[test]
fn a_claude_transcript_without_a_registry_entry_joins_the_claude_terminal_in_its_directory() {
    let now = at(5, 0);
    let mut facts = Facts::default();
    observe(
        &mut facts,
        SourceKind::Hc,
        Change::Reset(vec![
            // Runs Claude Code behind a wrapper, so no registry pid matches.
            Fact::Terminal(Box::new(TerminalFact {
                program: Some("claude-code".to_owned()),
                foreground_pid: Some(31),
                ..terminal("t-wrapped", 31)
            })),
            // Already holds its session through the registry.
            Fact::Terminal(Box::new(TerminalFact {
                program: Some("claude-code".to_owned()),
                ..terminal("t-registered", 32)
            })),
        ]),
        now,
    );
    observe(
        &mut facts,
        SourceKind::ClaudeRegistry,
        Change::Reset(vec![registry(32, "s-registered", false)]),
        now,
    );
    let in_work = |fact: Fact| match fact {
        Fact::Transcript(delta) => Fact::Transcript(TranscriptDelta {
            cwd: Some(PathBuf::from("/work")),
            ..delta
        }),
        other => other,
    };
    observe(
        &mut facts,
        SourceKind::ClaudeTranscripts,
        Change::Reset(vec![
            in_work(transcript(
                "s-registered",
                None,
                vec![usage(at(1, 0), 1, 1)],
            )),
            in_work(transcript("s-older", None, vec![usage(at(1, 0), 1, 1)])),
            in_work(transcript("s-newer", None, vec![usage(at(3, 0), 1, 1)])),
        ]),
        now,
    );

    let built = build_agents(&facts, now);

    let wrapped = &built.agents[&AgentId::terminal("t-wrapped")];
    assert_eq!(wrapped.session.as_deref(), Some("s-newer"));
    assert_eq!(
        built.agents[&AgentId::terminal("t-registered")]
            .session
            .as_deref(),
        Some("s-registered")
    );
    assert!(
        built
            .agents
            .contains_key(&AgentId::claude_session("s-older"))
    );
    assert_eq!(built.agents.len(), 3);
}

#[test]
fn a_registry_entry_behind_a_wrapper_joins_the_claude_terminal_in_its_directory() {
    let now = at(5, 0);
    let mut facts = Facts::default();
    observe(
        &mut facts,
        SourceKind::Hc,
        Change::Reset(vec![Fact::Terminal(Box::new(TerminalFact {
            program: Some("claude-code".to_owned()),
            activity: Some(TerminalActivity::Idle),
            ..terminal("t-wrap", 50)
        }))]),
        now,
    );
    observe(
        &mut facts,
        SourceKind::ClaudeRegistry,
        Change::Reset(vec![
            registry(51, "s-w", true),
            ClaudeSessionFact {
                cwd: Some(PathBuf::from("/elsewhere")),
                ..match registry(52, "s-x", false) {
                    Fact::ClaudeSession(session) => session,
                    _ => unreachable!(),
                }
            }
            .into_fact(),
        ]),
        now,
    );

    let built = build_agents(&facts, now);

    let agent = &built.agents[&AgentId::terminal("t-wrap")];
    assert_eq!(agent.session.as_deref(), Some("s-w"));
    assert!(agent.sources.contains(SourceKind::ClaudeRegistry));
    // hc says idle; a terminal's own status wins over the registry's.
    assert_eq!(agent.status, Status::Idle);
    assert!(built.agents.contains_key(&AgentId::claude_session("s-x")));
    assert_eq!(built.agents.len(), 2);
}

trait IntoFact {
    fn into_fact(self) -> Fact;
}

impl IntoFact for ClaudeSessionFact {
    fn into_fact(self) -> Fact {
        Fact::ClaudeSession(self)
    }
}

#[test]
fn an_agents_minutes_hold_one_series_per_measure() {
    let now = at(10, 0);
    let mut facts = Facts::default();
    observe(
        &mut facts,
        SourceKind::ClaudeTranscripts,
        Change::Reset(vec![transcript(
            "s-m",
            None,
            vec![
                usage(at(8, 0), 1_000_000, 0),
                TranscriptEvent {
                    at: at(9, 0),
                    kind: TranscriptEventKind::ToolStart {
                        id: "a".to_owned(),
                        name: "Bash".to_owned(),
                        gist: None,
                    },
                },
                TranscriptEvent {
                    at: at(9, 10),
                    kind: TranscriptEventKind::ToolEnd {
                        id: "a".to_owned(),
                        is_error: true,
                    },
                },
            ],
        )]),
        now,
    );

    let built = build_agents(&facts, now);
    let agent = built
        .agents
        .get(&AgentId::claude_session("s-m"))
        .expect("the transcript's agent");
    let last = ACTIVITY_MINUTES - 1;

    // Usage two minutes ago, the failed tool call one minute ago.
    assert_eq!(agent.minutes.tokens[last - 2], 1_000_000);
    assert!(agent.minutes.cost_usd[last - 2] > 0.0);
    assert_eq!(agent.minutes.tools[last - 1], 1);
    assert_eq!(agent.minutes.errors[last - 1], 1);
    assert_eq!(agent.minutes.tools[last - 2], 0);
    assert_eq!(agent.minutes.tokens[last - 1], 0);
}

#[test]
fn spend_since_splits_by_transcript_and_adds_up_to_the_minutes() {
    let now = at(10, 0);
    let mut facts = Facts::default();
    observe(
        &mut facts,
        SourceKind::ClaudeTranscripts,
        Change::Reset(vec![
            transcript(
                "s-m",
                None,
                vec![usage(at(1, 0), 1_000_000, 0), reported(at(3, 0), 12.0)],
            ),
            transcript("s-m", Some("sub"), vec![usage(at(4, 0), 500_000, 0)]),
        ]),
        now,
    );

    let since = at(2, 0);
    let spend = spend_since(&facts, since, now);
    let parts: f64 = spend.values().sum();
    let minutes: f64 = minute_counts(&facts, now)
        .range(since..)
        .map(|(_, counts)| counts.cost_usd)
        .sum();

    // Only the subagent spent after `since`: its $2 estimate scaled by two.
    assert_eq!(spend.len(), 1);
    assert_usd(Cost::Estimated(parts), 4.0);
    assert_usd(Cost::Estimated(minutes), 4.0);
}

#[test]
fn prune_drops_old_ended_agents_and_keeps_what_is_live() {
    let day_later = at(0, 0) + TimeDelta::hours(30);
    let history = TimeDelta::hours(24);
    let mut facts = Facts::default();
    // Two sessions written at the start; only "s-live" still has a process.
    observe(
        &mut facts,
        SourceKind::ClaudeTranscripts,
        Change::Reset(vec![
            transcript("s-old", None, vec![usage(at(1, 0), 10, 10)]),
            transcript("s-live", None, vec![usage(at(1, 0), 10, 10)]),
        ]),
        at(2, 0),
    );
    observe(
        &mut facts,
        SourceKind::ClaudeRegistry,
        Change::Reset(vec![registry(42, "s-live", false)]),
        at(2, 0),
    );
    let mut finished = terminal("t-done", 7);
    finished.state = TerminalState::Finished;
    finished.finished = Some(at(3, 0));
    let mut runner = terminal("t-run", 8);
    runner.name = "runner".to_owned();
    observe(
        &mut facts,
        SourceKind::Hc,
        Change::Reset(vec![
            Fact::Terminal(Box::new(finished)),
            Fact::Terminal(Box::new(runner)),
        ]),
        at(3, 0),
    );
    let record = |id: &str, terminal: Option<&str>| {
        Fact::RunRecord(RunRecordFact {
            id: id.to_owned(),
            task: None,
            label: None,
            status: Some("done".to_owned()),
            started: Some(at(0, 0)),
            pid: None,
            terminal: terminal.map(str::to_owned),
            cost: None,
        })
    };
    observe(
        &mut facts,
        SourceKind::RunRecord,
        Change::Reset(vec![
            record("run-old", None),
            record("run-held", Some("runner")),
        ]),
        at(3, 0),
    );

    // Within the window nothing goes.
    assert_eq!(facts.prune(at(30, 0), history), 0);

    let dropped = facts.prune(day_later, history);
    let built = build_agents(&facts, day_later);

    assert_eq!(
        dropped, 3,
        "the old session, the finished terminal, the old run"
    );
    assert!(!built.agents.contains_key(&AgentId::claude_session("s-old")));
    assert!(!built.agents.contains_key(&AgentId::terminal("t-done")));
    assert!(!built.agents.contains_key(&AgentId::run("run-old")));
    assert!(
        built
            .owners
            .contains_key(&FactKey::Transcript(TranscriptKey {
                program: TranscriptProgram::Claude,
                session: "s-live".to_owned(),
                subagent: None,
            })),
        "a session with a running process is kept"
    );
    assert!(built.agents.contains_key(&AgentId::terminal("t-run")));
    assert!(
        built
            .owners
            .contains_key(&FactKey::RunRecord("run-held".to_owned())),
        "a run its live terminal runs is kept"
    );
}
