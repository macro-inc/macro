use std::sync::Mutex;

use trigger_context::origin::{Caller, RoutineCause};
use uuid::Uuid;

use super::*;
use crate::testing::{FixedTaskDirectory, InMemoryAgentSessionRepo, test_agent_session};

const APP: &str = "https://macro.com/";

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("owner@example.com").unwrap()
}

fn person() -> Caller {
    Caller::Person { user: owner() }
}

fn session_with(origin: TriggerOrigin) -> AgentSession {
    let mut session = test_agent_session(AgentSessionId::new());
    session.origin = origin;
    session
}

#[test]
fn a_mention_links_its_channel_message_and_thread() {
    let channel = Uuid::from_u128(1);
    let thread = Uuid::from_u128(2);
    let message = Uuid::from_u128(3);
    let mut session = session_with(TriggerOrigin::Mentioned {
        by: person(),
        message_id: message,
    });
    session.thread_parent = Some(MessageParent::Channel(channel));
    session.thread_id = Some(thread);
    let links = PullRequestBacklinks::for_session(&session, APP, None);
    assert_eq!(
        links.session_url,
        format!("https://macro.com/app/agent/{}", session.id)
    );
    assert_eq!(
        links.source,
        PullRequestSource {
            kind: PullRequestSourceKind::ChannelMessage,
            url: format!(
                "https://macro.com/app/channel/{channel}?channel_message_id={message}&channel_thread_id={thread}"
            ),
        }
    );

    // A thread's own root message needs no thread parameter.
    session.thread_id = Some(message);
    assert_eq!(
        PullRequestBacklinks::for_session(&session, APP, None)
            .source
            .url,
        format!("https://macro.com/app/channel/{channel}?channel_message_id={message}")
    );
}

#[test]
fn tasks_routines_and_prompts_link_what_started_them() {
    let routine = Uuid::from_u128(9);
    let cases = [
        (
            TriggerOrigin::TaskAssigned {
                by: person(),
                task: "task-1".into(),
            },
            PullRequestSourceKind::Task,
            "https://macro.com/app/task/task-1".to_owned(),
        ),
        (
            TriggerOrigin::ProjectInherited {
                by: person(),
                task: "task-2".into(),
                project: Uuid::from_u128(4),
            },
            PullRequestSourceKind::Task,
            "https://macro.com/app/task/task-2".to_owned(),
        ),
        (
            TriggerOrigin::Routine {
                routine,
                firing: RoutineCause::Scheduled,
            },
            PullRequestSourceKind::Routine,
            format!("https://macro.com/app/routines/{routine}"),
        ),
    ];
    for (origin, kind, url) in cases {
        let links = PullRequestBacklinks::for_session(&session_with(origin), APP, None);
        assert_eq!(links.source, PullRequestSource { kind, url });
    }

    let prompted = session_with(TriggerOrigin::Requested { by: owner() });
    let links = PullRequestBacklinks::for_session(&prompted, APP, None);
    assert_eq!(links.source.kind, PullRequestSourceKind::SessionPrompt);
    assert_eq!(links.source.url, links.session_url);
}

#[test]
fn an_unrecorded_origin_falls_back_to_the_message_then_the_linked_task() {
    let mut session = session_with(TriggerOrigin::Unknown);
    let message = Uuid::from_u128(3);
    session.thread_parent = Some(MessageParent::Channel(Uuid::from_u128(1)));
    session.originating_message_id = Some(message);
    session.task_id = Some("task-1".into());
    // A task the agent linked later does not replace the message that opened it.
    assert_eq!(
        PullRequestBacklinks::for_session(&session, APP, None)
            .source
            .kind,
        PullRequestSourceKind::ChannelMessage
    );
    session.thread_parent = None;
    assert_eq!(
        PullRequestBacklinks::for_session(&session, APP, None)
            .source
            .kind,
        PullRequestSourceKind::Task
    );
    session.task_id = None;
    let links = PullRequestBacklinks::for_session(&session, APP, None);
    assert_eq!(links.source.kind, PullRequestSourceKind::NotRecorded);
    assert_eq!(links.source.url, links.session_url);

    let dispatched = session_with(TriggerOrigin::Dispatched {
        on_behalf_of: owner(),
    });
    assert_eq!(
        PullRequestBacklinks::for_session(&dispatched, APP, None)
            .source
            .kind,
        PullRequestSourceKind::Dispatched
    );
}

#[test]
fn a_mention_in_another_entitys_thread_links_that_entity_or_names_it() {
    let message = Uuid::from_u128(3);
    let mut session = session_with(TriggerOrigin::Mentioned {
        by: person(),
        message_id: message,
    });
    session.thread_id = Some(message);
    let task = "0198a1b2-0000-7000-8000-00000000000a";
    session.thread_parent = Some(MessageParent::Document(task.to_owned().try_into().unwrap()));

    // A task's thread links the task.
    assert_eq!(
        PullRequestBacklinks::for_session(&session, APP, Some(task)).source,
        PullRequestSource {
            kind: PullRequestSourceKind::TaskThread,
            url: format!("https://macro.com/app/task/{task}"),
        }
    );
    // Another document's thread has no link of its own and says so.
    let links = PullRequestBacklinks::for_session(&session, APP, None);
    assert_eq!(links.source.kind, PullRequestSourceKind::DocumentThread);
    assert_eq!(links.source.url, links.session_url);
    assert!(
        links
            .block()
            .contains("Source (a document thread, see the session)")
    );

    let project = Uuid::from_u128(5);
    session.thread_parent = Some(MessageParent::Initiative(project));
    assert_eq!(
        PullRequestBacklinks::for_session(&session, APP, None).source,
        PullRequestSource {
            kind: PullRequestSourceKind::ProjectThread,
            url: format!("https://macro.com/app/tasks/projects/{project}/overview"),
        }
    );
    for (parent, kind) in [
        (
            MessageParent::CrmCompany(Uuid::from_u128(6)),
            PullRequestSourceKind::CrmThread,
        ),
        (
            MessageParent::CrmContact(Uuid::from_u128(7)),
            PullRequestSourceKind::CrmThread,
        ),
        (
            MessageParent::Call(Uuid::from_u128(8)),
            PullRequestSourceKind::CallThread,
        ),
    ] {
        session.thread_parent = Some(parent);
        let links = PullRequestBacklinks::for_session(&session, APP, None);
        assert_eq!(links.source.kind, kind);
        assert_eq!(links.source.url, links.session_url);
    }
}

#[tokio::test]
async fn the_service_links_the_task_whose_thread_started_the_session() {
    let task = "0198a1b2-0000-7000-8000-00000000000a";
    let message = Uuid::from_u128(3);
    let mut session = session_with(TriggerOrigin::Mentioned {
        by: person(),
        message_id: message,
    });
    session.thread_parent = Some(MessageParent::Document(task.to_owned().try_into().unwrap()));
    let repo = InMemoryAgentSessionRepo::new();
    repo.insert_session(session.clone());
    let descriptions = Arc::new(FakeDescriptions::default());
    let service = PullRequestBacklinkService::new(
        repo.clone(),
        FixedTaskDirectory {
            tasks: vec![task.to_owned()],
        },
        descriptions,
        APP,
    );
    let linked = service
        .link_description(session.id, &owner(), PR)
        .await
        .unwrap();
    assert_eq!(
        linked.backlinks.source.kind,
        PullRequestSourceKind::TaskThread
    );

    // A document that is not a task.
    let service = PullRequestBacklinkService::new(
        repo,
        FixedTaskDirectory::default(),
        Arc::new(FakeDescriptions::default()),
        APP,
    );
    let linked = service
        .link_description(session.id, &owner(), PR)
        .await
        .unwrap();
    assert_eq!(
        linked.backlinks.source.kind,
        PullRequestSourceKind::DocumentThread
    );
}

#[test]
fn the_block_is_appended_once_and_replaced_in_place() {
    let session = session_with(TriggerOrigin::TaskAssigned {
        by: person(),
        task: "task-1".into(),
    });
    let links = PullRequestBacklinks::for_session(&session, APP, None);
    let block = links.block();
    assert_eq!(
        block,
        format!(
            "{BLOCK_START}\nMacro agent session: https://macro.com/app/agent/{}\n\nSource (task): https://macro.com/app/task/task-1\n{BLOCK_END}",
            session.id
        )
    );
    assert_eq!(links.applied_to(""), block);
    let added = links.applied_to("## Why\n\nBecause.\n\n");
    assert_eq!(added, format!("## Why\n\nBecause.\n\n{block}\n"));
    assert!(links.linked_in(&added));
    assert!(!links.linked_in("## Why\n\nBecause."));
    // The same links outside a block are not enough.
    assert!(!links.linked_in(&format!("{} {}", links.session_url, links.source.url)));
    assert!(links.linked_in(&added.replace('\n', "\r\n")));

    // This session's earlier block, with a stale source, is replaced in place.
    let stale = format!(
        "Intro\n\n{BLOCK_START}\nMacro agent session: {}\n\nSource (task): old\n{BLOCK_END}\n\nOutro",
        links.session_url
    );
    assert_eq!(
        links.applied_to(&stale),
        format!("Intro\n\n{block}\n\nOutro")
    );
}

#[test]
fn other_text_and_other_sessions_blocks_are_kept() {
    let session = session_with(TriggerOrigin::TaskAssigned {
        by: person(),
        task: "task-1".into(),
    });
    let links = PullRequestBacklinks::for_session(&session, APP, None);
    let block = links.block();
    let other = format!(
        "{BLOCK_START}\nMacro agent session: https://macro.com/app/agent/other\nSource (task): https://macro.com/app/task/task-0\n{BLOCK_END}"
    );
    let cases = [
        // Another session's provenance stays beside this one.
        format!("Intro\n\n{other}"),
        // A marker quoted in prose, before another block, is not a block.
        format!("Writes a `{BLOCK_START}` block.\n\nMore text.\n\n{other}"),
        // A marker alone on a line with no end, then another start.
        format!("{BLOCK_START}\nkept\n{other}"),
        // An end before any start.
        format!("{BLOCK_END}\nText"),
    ];
    for description in cases {
        assert_eq!(
            links.applied_to(&description),
            format!("{}\n\n{block}\n", description.trim_end()),
            "{description}"
        );
    }
}

#[test]
fn parses_pull_request_numbers() {
    assert_eq!(
        PullRequestNumber::parse("https://github.com/org/repo/pull/12#top").unwrap(),
        PullRequestNumber {
            owner: "org".into(),
            repo: "repo".into(),
            number: 12,
        }
    );
    assert!(PullRequestNumber::parse("https://github.com/org/repo/issues/12").is_err());
}

/// A GitHub description held in memory, or one Macro may not touch.
#[derive(Default)]
struct FakeDescriptions {
    body: Mutex<String>,
    writes: Mutex<u32>,
    refuse: bool,
}

impl PullRequestDescriptions for FakeDescriptions {
    fn read<'a>(
        &'a self,
        _owner: &'a MacroUserIdStr<'static>,
        _pull_request: &'a PullRequestNumber,
    ) -> Pin<
        Box<
            dyn Future<Output = std::result::Result<String, PullRequestDescriptionError>>
                + Send
                + 'a,
        >,
    > {
        Box::pin(async move {
            if self.refuse {
                return Err(PullRequestDescriptionError::NotLinked);
            }
            Ok(self.body.lock().unwrap().clone())
        })
    }

    fn write<'a>(
        &'a self,
        _owner: &'a MacroUserIdStr<'static>,
        _pull_request: &'a PullRequestNumber,
        description: &'a str,
    ) -> Pin<
        Box<dyn Future<Output = std::result::Result<(), PullRequestDescriptionError>> + Send + 'a>,
    > {
        Box::pin(async move {
            *self.body.lock().unwrap() = description.to_owned();
            *self.writes.lock().unwrap() += 1;
            Ok(())
        })
    }
}

const PR: &str = "https://github.com/org/repo/pull/1";

#[tokio::test]
async fn writes_the_links_into_the_description_once() {
    let repo = InMemoryAgentSessionRepo::new();
    let session = session_with(TriggerOrigin::TaskAssigned {
        by: person(),
        task: "task-1".into(),
    });
    repo.insert_session(session.clone());
    let descriptions = Arc::new(FakeDescriptions {
        body: Mutex::new("## Why\n\nBecause.".into()),
        ..Default::default()
    });
    let service = PullRequestBacklinkService::new(
        repo,
        FixedTaskDirectory::default(),
        descriptions.clone(),
        APP,
    );

    let linked = service
        .link_description(session.id, &owner(), PR)
        .await
        .unwrap();
    assert_eq!(linked.description, DescriptionLinks::Added);
    assert!(
        linked
            .backlinks
            .linked_in(&descriptions.body.lock().unwrap())
    );

    let again = service
        .link_description(session.id, &owner(), PR)
        .await
        .unwrap();
    assert_eq!(again.description, DescriptionLinks::AlreadyLinked);
    assert_eq!(*descriptions.writes.lock().unwrap(), 1);
}

#[tokio::test]
async fn a_description_macro_cannot_edit_is_left_to_the_agent() {
    let repo = InMemoryAgentSessionRepo::new();
    let session = session_with(TriggerOrigin::Requested { by: owner() });
    repo.insert_session(session.clone());
    let service = PullRequestBacklinkService::new(
        repo,
        FixedTaskDirectory::default(),
        Arc::new(FakeDescriptions {
            refuse: true,
            ..Default::default()
        }),
        APP,
    );
    let linked = service
        .link_description(session.id, &owner(), PR)
        .await
        .unwrap();
    assert_eq!(
        linked.description,
        DescriptionLinks::NotWritten {
            reason: PullRequestDescriptionError::NotLinked.to_string()
        }
    );

    let stranger = MacroUserIdStr::try_from_email("someone@example.com").unwrap();
    assert!(matches!(
        service.link_description(session.id, &stranger, PR).await,
        Err(AgentSessionError::Forbidden)
    ));
}

fn mentioned_in_a_channel() -> AgentSession {
    let message = Uuid::from_u128(3);
    let mut session = session_with(TriggerOrigin::Mentioned {
        by: person(),
        message_id: message,
    });
    session.thread_parent = Some(MessageParent::Channel(Uuid::from_u128(1)));
    session.thread_id = Some(message);
    session
}

#[test]
fn an_old_format_or_stale_label_block_is_rewritten() {
    let links = PullRequestBacklinks::for_session(&mentioned_in_a_channel(), APP, None);
    // The earlier run-on format: no blank line between the links.
    let run_on = format!(
        "Text\n\n{BLOCK_START}\nMacro agent session: {}\nSource (channel message): {}\n{BLOCK_END}\n",
        links.session_url, links.source.url
    );
    assert!(!links.linked_in(&run_on));
    assert_eq!(
        links.updated(&run_on),
        Some(format!("Text\n\n{}\n", links.block()))
    );
    // The same URL under another label.
    let stale = format!(
        "{BLOCK_START}\nMacro agent session: {}\n\nSource (agent session prompt): {}\n{BLOCK_END}",
        links.session_url, links.source.url
    );
    assert!(!links.linked_in(&stale));
    assert_eq!(links.updated(&stale), Some(links.block()));

    let current = format!("Text\n\n{}\n", links.block());
    assert!(links.linked_in(&current));
    assert!(links.linked_in(&current.replace('\n', "\r\n")));
    assert_eq!(links.updated(&current), None);
}

#[test]
fn loose_link_lines_are_removed_and_other_loose_links_are_reported() {
    let links = PullRequestBacklinks::for_session(&mentioned_in_a_channel(), APP, None);
    // What agents wrote before the block existed.
    let loose = format!(
        "## Why\n\nBecause.\n\nMacro agent session: {}\n- Source: {}\n",
        links.session_url, links.source.url
    );
    let updated = links.updated(&loose).unwrap();
    assert_eq!(
        updated,
        format!("## Why\n\nBecause.\n\n{}\n", links.block())
    );
    assert!(!links.loose_source(&updated));

    // A link inside a sentence is not removed; the agent is told to.
    let prose = format!(
        "Started from {} today.\n\n{}\n",
        links.source.url,
        links.block()
    );
    assert_eq!(links.updated(&prose), None);
    assert!(links.loose_source(&prose));

    // A task or the session itself may appear anywhere.
    let task = PullRequestBacklinks::for_session(
        &session_with(TriggerOrigin::TaskAssigned {
            by: person(),
            task: "task-1".into(),
        }),
        APP,
        None,
    );
    assert!(!task.loose_source(&format!("See {}.\n\n{}", task.source.url, task.block())));
}

#[tokio::test]
async fn the_service_reports_a_loose_source_it_left_in_place() {
    let repo = InMemoryAgentSessionRepo::new();
    let session = mentioned_in_a_channel();
    repo.insert_session(session.clone());
    let links = PullRequestBacklinks::for_session(&session, APP, None);
    let descriptions = Arc::new(FakeDescriptions {
        body: Mutex::new(format!("Started from {} today.", links.source.url)),
        ..Default::default()
    });
    let service = PullRequestBacklinkService::new(
        repo,
        FixedTaskDirectory::default(),
        descriptions.clone(),
        APP,
    );
    let linked = service
        .link_description(session.id, &owner(), PR)
        .await
        .unwrap();
    assert_eq!(linked.description, DescriptionLinks::Added);
    assert!(linked.loose_source);
}
