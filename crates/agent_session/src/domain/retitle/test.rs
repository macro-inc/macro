use super::*;
use agent_fold::domain::model::TurnId;

fn message(turn: u32, author: Author, parts: Vec<MessagePart>) -> FoldedMessage {
    FoldedMessage {
        id: TurnId(turn),
        author,
        request_id: None,
        parts: non_empty::NonEmpty::new(parts).expect("at least one part"),
        stop: None,
        pending: false,
        posted_at: None,
    }
}

fn text(text: &str) -> MessagePart {
    MessagePart::Text { text: text.into() }
}

fn user(turn: u32, prose: &str) -> FoldedMessage {
    message(turn, Author::User { user_id: None }, vec![text(prose)])
}

fn agent(turn: u32, parts: Vec<MessagePart>) -> FoldedMessage {
    message(turn, Author::Agent, parts)
}

#[test]
fn keeps_the_first_prompt_and_the_latest_messages() {
    let messages: Vec<_> = (0..20)
        .flat_map(|turn| {
            [
                user(turn, &format!("prompt {turn}")),
                agent(turn, vec![text(&format!("reply {turn}"))]),
            ]
        })
        .collect();
    let digest = ConversationDigest::from_messages(&messages);
    let texts: Vec<_> = digest.messages.iter().map(|m| m.text.as_str()).collect();
    assert_eq!(
        texts,
        [
            "prompt 0",
            "prompt 16",
            "reply 16",
            "prompt 17",
            "reply 17",
            "prompt 18",
            "reply 18",
            "prompt 19",
            "reply 19",
        ]
    );
}

#[test]
fn short_conversations_are_kept_whole() {
    let digest = ConversationDigest::from_messages(&[
        user(0, "fix the login"),
        agent(0, vec![text("Fixed the OAuth redirect.")]),
    ]);
    assert_eq!(digest.messages.len(), 2);
    assert!(digest.has_reply());
    assert!(ConversationDigest::from_messages(&[]).messages.is_empty());
}

#[test]
fn keeps_only_the_agents_last_prose_and_drops_reasoning() {
    let digest = ConversationDigest::from_messages(&[
        user(0, "why is the deploy failing"),
        agent(
            0,
            vec![
                text("Looking at the logs."),
                MessagePart::Thought {
                    text: "secret reasoning".into(),
                },
                text("The migration timed out on a lock."),
            ],
        ),
        agent(
            1,
            vec![MessagePart::Thought {
                text: "only thinking".into(),
            }],
        ),
    ]);
    assert_eq!(
        digest.messages,
        [
            DigestMessage {
                role: DigestRole::User,
                text: "why is the deploy failing".into(),
            },
            DigestMessage {
                role: DigestRole::Agent,
                text: "The migration timed out on a lock.".into(),
            },
        ]
    );
}

#[test]
fn a_prompt_without_a_reply_has_no_reply() {
    let digest = ConversationDigest::from_messages(&[user(0, "investigate issue")]);
    assert!(!digest.has_reply());
}

#[test]
fn bounds_each_message_without_splitting_characters() {
    let digest = ConversationDigest::from_messages(&[user(0, &"🦀".repeat(5_000))]);
    assert_eq!(digest.messages[0].text.chars().count(), MAX_MESSAGE_CHARS);
}
