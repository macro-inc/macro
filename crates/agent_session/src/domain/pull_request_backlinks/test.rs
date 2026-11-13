use std::sync::Mutex;

use trigger_context::origin::{Caller, RoutineCause};
use uuid::Uuid;

use super::*;
use crate::testing::{InMemoryAgentSessionRepo, test_agent_session};

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
    let links = PullRequestBacklinks::for_session(&session, APP);
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
        PullRequestBacklinks::for_session(&session, APP).source.url,
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
        let links = PullRequestBacklinks::for_session(&session_with(origin), APP);
        assert_eq!(links.source, PullRequestSource { kind, url });
    }

    let prompted = session_with(TriggerOrigin::Requested { by: owner() });
    let links = PullRequestBacklinks::for_session(&prompted, APP);
    assert_eq!(links.source.kind, PullRequestSourceKind::SessionPrompt);
    assert_eq!(links.source.url, links.session_url);
}

#[test]
fn an_unrecorded_origin_falls_back_to_the_linked_task_then_the_message() {
    let mut session = session_with(TriggerOrigin::Unknown);
    let message = Uuid::from_u128(3);
    session.thread_parent = Some(MessageParent::Channel(Uuid::from_u128(1)));
    session.originating_message_id = Some(message);
    session.task_id = Some("task-1".into());
    assert_eq!(
        PullRequestBacklinks::for_session(&session, APP).source.kind,
        PullRequestSourceKind::Task
    );
    session.task_id = None;
    assert_eq!(
        PullRequestBacklinks::for_session(&session, APP).source.kind,
        PullRequestSourceKind::ChannelMessage
    );
    session.thread_parent = None;
    assert_eq!(
        PullRequestBacklinks::for_session(&session, APP).source.kind,
        PullRequestSourceKind::SessionPrompt
    );
}

#[test]
fn the_block_is_appended_once_and_replaced_in_place() {
    let session = session_with(TriggerOrigin::TaskAssigned {
        by: person(),
        task: "task-1".into(),
    });
    let links = PullRequestBacklinks::for_session(&session, APP);
    let block = links.block();
    assert_eq!(
        block,
        format!(
            "{BLOCK_START}\nMacro agent session: https://macro.com/app/agent/{}\nSource (task): https://macro.com/app/task/task-1\n{BLOCK_END}",
            session.id
        )
    );
    assert_eq!(links.applied_to(""), block);
    let added = links.applied_to("## Why\n\nBecause.\n\n");
    assert_eq!(added, format!("## Why\n\nBecause.\n\n{block}\n"));
    assert!(links.linked_in(&added));
    assert!(!links.linked_in("## Why\n\nBecause."));

    // This session's earlier block, with a stale source, is replaced in place.
    let stale = format!(
        "Intro\n\n{BLOCK_START}\nMacro agent session: {}\nSource (task): old\n{BLOCK_END}\n\nOutro",
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
    let links = PullRequestBacklinks::for_session(&session, APP);
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
    let service = PullRequestBacklinkService::new(repo, descriptions.clone(), APP);

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
