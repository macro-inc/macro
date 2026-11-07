use super::*;

fn other_person() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("editor@example.com").expect("a valid user id")
}

/// Mentioning the agent in a thread, by its starter or anyone following up
/// there, follows the session for nobody; neither does a runtime forwarding a
/// triggered prompt nor a bot acting for nobody. A prompt a person types into
/// the session itself follows it for that person, owner or not.
#[tokio::test]
async fn only_prompts_typed_into_the_session_follow_it() {
    let ((service, repo, containers, _announcer, _runtimes), mut turns) =
        harness_with_signals(PromptContextMock::default(), PromptComposerMock::default());
    let id = AgentSessionId::new();
    let container = live_session(&service, &containers, id).await;
    let agent = container.agent();
    turns.settled(id).await;
    assert!(
        repo.followers(id).is_empty(),
        "the opening mention follows nothing"
    );

    let follow_up = service.execute(
        id,
        HarnessCommand::Deliver(forward_message("a follow-up in the thread")),
    );
    let (result, ()) = tokio::join!(follow_up, agent.completes_prompt());
    result.expect("a thread follow-up should deliver");
    turns.settled(id).await;

    for (actor, context) in [(Some(other_person()), Some(trigger())), (None, None)] {
        let prompted = service.control_event(
            id,
            ControlEvent {
                action: AgentAction::prompt("not typed by a person"),
                action_id: None,
                actor,
                context,
            },
        );
        let (result, ()) = tokio::join!(prompted, agent.completes_prompt());
        result.expect("the prompt should deliver");
        turns.settled(id).await;
    }
    assert!(
        repo.followers(id).is_empty(),
        "thread, forwarded and bot prompts follow nothing"
    );

    for person in [other_person(), sender()] {
        let prompted = service.control_event(
            id,
            ControlEvent {
                action: AgentAction::prompt("typed into the session"),
                action_id: None,
                actor: Some(person),
                context: None,
            },
        );
        let (result, ()) = tokio::join!(prompted, agent.completes_prompt());
        result.expect("a direct prompt should deliver");
        turns.settled(id).await;
    }
    assert_eq!(repo.followers(id), vec![other_person(), sender()]);
}
