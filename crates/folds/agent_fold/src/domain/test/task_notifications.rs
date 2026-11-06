use super::util::parse_log;
use crate::domain::fold::fold;
use crate::domain::model::{Author, AuthorKind, MessagePart, StopReason, TaskStatus};

#[test]
fn cli_task_reports_join_the_agent_reply_and_typed_xml_stays_a_prompt() {
    let messages = fold(parse_log(
        r#"
{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s","update":{"sessionUpdate":"user_message_chunk","content":{"type":"text","text":"Run the tests in the background."}}}}}
{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Waiting for the test run to finish."}}}}}
{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","method":"_session/turn_complete","params":{"sessionId":"s","outcome":{"kind":"finished"}}}}
{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s","update":{"sessionUpdate":"user_message_chunk","content":{"type":"text","text":"<task-notification>\n<task-id>bf1lef9e9</task-id>\n<tool-use-id>toolu_01</tool-use-id>\n<output-file>/tmp/tasks/bf1lef9e9.output</output-file>\n<status>completed</status>\n<summary>Background command \"cargo test &gt; out.log\" completed (exit code 0)</summary>\n</task-notification>\n<task-notification>\n<task-id>b88i97ihr</task-id>\n<summary>Monitor event: \"PR checks\"</summary>\n<event>check: fail</event>\n</task-notification>\n<task-notification>\n<task-id>a05</task-id>\n<status>completed</status>\n<summary>Agent \"Research\" finished</summary>\n<result>Found <b>two</b> callers.</result>\n</task-notification>"},"_meta":{"claudeCode":{"origin":"task-notification"}}}}}}
{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"The tests passed."}}}}}
{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","method":"_session/turn_complete","params":{"sessionId":"s","outcome":{"kind":"finished"}}}}
{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s","update":{"sessionUpdate":"user_message_chunk","content":{"type":"text","text":"<task-notification><status>failed</status></task-notification>"}}}}}
"#,
    ));

    let parts: Vec<_> = messages
        .iter()
        .map(|message| {
            (
                message.author.kind(),
                message.parts.to_vec(),
                message.stop.clone(),
            )
        })
        .collect();
    assert_eq!(
        parts,
        [
            (
                AuthorKind::User,
                vec![MessagePart::Text {
                    text: "Run the tests in the background.".to_owned(),
                }],
                None,
            ),
            (
                AuthorKind::Agent,
                vec![MessagePart::Text {
                    text: "Waiting for the test run to finish.".to_owned(),
                }],
                Some(StopReason::EndTurn),
            ),
            (
                AuthorKind::Agent,
                vec![
                    MessagePart::TaskNotification {
                        status: Some(TaskStatus::Completed),
                        summary:
                            "Background command \"cargo test > out.log\" completed (exit code 0)"
                                .to_owned(),
                        event: None,
                    },
                    MessagePart::TaskNotification {
                        status: None,
                        summary: "Monitor event: \"PR checks\"".to_owned(),
                        event: Some("check: fail".to_owned()),
                    },
                    MessagePart::TaskNotification {
                        status: Some(TaskStatus::Completed),
                        summary: "Agent \"Research\" finished".to_owned(),
                        event: None,
                    },
                    MessagePart::Text {
                        text: "The tests passed.".to_owned(),
                    },
                ],
                Some(StopReason::EndTurn),
            ),
            // Untagged, the same XML is something a person typed.
            (
                AuthorKind::User,
                vec![MessagePart::Text {
                    text: "<task-notification><status>failed</status></task-notification>"
                        .to_owned(),
                }],
                None,
            ),
        ]
    );
}

#[test]
fn a_tagged_report_that_does_not_parse_still_never_reads_as_a_prompt() {
    let messages = fold(parse_log(
        r#"
{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s","update":{"sessionUpdate":"user_message_chunk","content":{"type":"text","text":"<task-notification><status>completed"},"_meta":{"claudeCode":{"origin":"task-notification"}}}}}}
"#,
    ));
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0].author, Author::Agent);
    assert_eq!(
        messages[0].parts.to_vec(),
        [MessagePart::TaskNotification {
            status: None,
            summary: String::new(),
            event: None,
        }]
    );
}
