//! The binary must answer every request it read before exiting.
//!
//! Found by hand: piping a batch of frames and closing stdin returned only
//! the first response. `serve` returns on EOF, which completed the
//! `tokio::select!` in `main` and cancelled the stdout writer with responses
//! still queued behind it — so a client that batches its requests and closes
//! stdin silently loses answers.
//!
//! This is an integration test rather than a unit one because the bug lives
//! in how `main` composes `serve` with the writer task, which is exactly what
//! no unit test of `dispatch` can reach.

use std::io::{BufRead as _, BufReader, Write as _};
use std::process::{Command, Stdio};

/// Requests that need no network: the handshake, a session, and two closes.
const FRAMES: &[&str] = &[
    r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1}}"#,
    r#"{"jsonrpc":"2.0","id":2,"method":"session/new","params":{"cwd":"/tmp"}}"#,
    r#"{"jsonrpc":"2.0","id":3,"method":"session/close","params":{"sessionId":"cursor-acp-1"}}"#,
    r#"{"jsonrpc":"2.0","id":4,"method":"session/set_mode","params":{}}"#,
];

#[test]
fn every_request_read_before_eof_is_answered() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_cursor_acp"))
        // Shape-valid so startup validation passes; nothing here reaches the
        // network, so it is never used as a credential.
        .env("CURSOR_API_KEY", "crsr_integration_test")
        .env("CURSOR_ACP_LOG_DIR", "off")
        .env_remove("CURSOR_ACP_RECORD_DIR")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("the binary runs");

    {
        let stdin = child.stdin.as_mut().expect("stdin is piped");
        for frame in FRAMES {
            writeln!(stdin, "{frame}").expect("frames are writable");
        }
        // Closing stdin is the whole point: it is what used to strand the
        // queued responses.
    }
    child.stdin.take();

    let stdout = child.stdout.take().expect("stdout is piped");
    let ids: Vec<i64> = BufReader::new(stdout)
        .lines()
        .map(|line| line.expect("stdout is readable"))
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| {
            let frame: serde_json::Value = serde_json::from_str(&line).expect("a json frame");
            frame.get("id").and_then(serde_json::Value::as_i64)
        })
        .collect();

    child.wait().expect("the binary exits");

    assert_eq!(
        ids,
        vec![1, 2, 3, 4],
        "every request must be answered before exit, in order"
    );
}
