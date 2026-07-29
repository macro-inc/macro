use std::collections::VecDeque;
use std::error::Error;
use std::fmt::{self, Display, Formatter};
use std::future::{Future, ready};

use serde_json::{Value, json};

use super::*;

#[derive(Default)]
struct Harness {
    sent_to_subject: Vec<Value>,
    emitted_by_subject: VecDeque<Value>,
}

#[derive(Debug)]
struct HarnessError;

impl Display for HarnessError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> fmt::Result {
        formatter.write_str("test harness error")
    }
}

impl Error for HarnessError {}

impl Harness {
    fn with_emitted(messages: impl IntoIterator<Item = Value>) -> Self {
        Self {
            sent_to_subject: Vec::new(),
            emitted_by_subject: messages.into_iter().collect(),
        }
    }
}

impl WireHarness for Harness {
    type Error = HarnessError;

    fn send_to_subject(
        &mut self,
        message: Value,
    ) -> impl Future<Output = Result<(), Self::Error>> + Send {
        self.sent_to_subject.push(message);
        ready(Ok(()))
    }

    fn receive_from_subject(&mut self) -> impl Future<Output = Result<Value, Self::Error>> + Send {
        let message = self
            .emitted_by_subject
            .pop_front()
            .expect("fixture should provide the next emitted message");
        ready(Ok(message))
    }
}

fn conversation() -> WireTest {
    WireTest::new([
        to_server(json!({
            "type": "event",
            "event": "runtime/ready"
        })),
        to_runtime(json!({
            "type": "acp",
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": { "protocolVersion": 1 }
        })),
        to_server(json!({
            "type": "acp",
            "jsonrpc": "2.0",
            "id": 1,
            "result": { "protocolVersion": 1 }
        })),
    ])
}

#[tokio::test]
async fn one_transcript_exercises_the_runtime_and_server() {
    let test = conversation();

    let mut runtime = Harness::with_emitted([
        test.messages()[0].message().clone(),
        test.messages()[2].message().clone(),
    ]);
    test.run_runtime(&mut runtime)
        .await
        .expect("runtime should satisfy transcript");
    assert_eq!(
        runtime.sent_to_subject,
        [test.messages()[1].message().clone()]
    );

    let mut server = Harness::with_emitted([test.messages()[1].message().clone()]);
    test.run_server(&mut server)
        .await
        .expect("server should satisfy transcript");
    assert_eq!(
        server.sent_to_subject,
        [
            test.messages()[0].message().clone(),
            test.messages()[2].message().clone(),
        ]
    );
}

#[tokio::test]
async fn mismatch_reports_step_direction_and_values() {
    let test = WireTest::new([to_server(json!({
        "jsonrpc": "2.0",
        "id": 1,
        "result": { "expected": true }
    }))]);
    let mut runtime = Harness::with_emitted([json!({"actual": true})]);

    let failure = test
        .run_runtime(&mut runtime)
        .await
        .expect_err("different JSON should fail");

    let WireTestFailure::Mismatch {
        step,
        direction,
        expected,
        actual,
    } = failure
    else {
        panic!("expected a mismatch failure");
    };

    assert_eq!(step, 0);
    assert_eq!(direction, Direction::ToServer);
    assert_eq!(
        expected,
        json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": { "expected": true }
        })
    );
    assert_eq!(actual, json!({"actual": true}));
}
