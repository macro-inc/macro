use super::*;

#[test]
fn the_tail_keeps_the_last_window_of_bytes_in_order() {
    let mut tail = Tail::default();
    tail.push(b"abc");
    tail.push(b"def");
    assert_eq!(tail.bytes(), b"abcdef");

    let filler = vec![b'x'; TAIL_BYTES - 4];
    tail.push(&filler);
    let bytes = tail.bytes();
    assert_eq!(bytes.len(), TAIL_BYTES);
    assert!(
        bytes.starts_with(b"cdef"),
        "the oldest bytes past the window are forgotten first"
    );

    let oversized = vec![b'y'; TAIL_BYTES + 10];
    tail.push(&oversized);
    assert_eq!(tail.bytes(), vec![b'y'; TAIL_BYTES]);
}

#[test]
fn the_partial_frame_is_whatever_follows_the_last_blank_line() {
    assert_eq!(
        partial_frame(b"event: a\ndata: 1\n\nevent: b\ndata: 2"),
        b"event: b\ndata: 2"
    );
    assert_eq!(
        partial_frame(b"event: a\r\ndata: 1\r\n\r\ndata: {\"half"),
        b"data: {\"half"
    );
    assert_eq!(partial_frame(b"event: a\ndata: 1\n\n"), b"");
    assert_eq!(
        partial_frame(b"no boundary yet"),
        b"no boundary yet",
        "a connection cut inside its first record is all partial frame"
    );
    assert_eq!(
        partial_frame(b"data: 1\r\n\r\ndata: 2\n\ndata: 3"),
        b"data: 3",
        "the later of the two line endings' boundaries wins"
    );
}

#[derive(Debug)]
struct Layer {
    message: &'static str,
    source: Option<Box<Layer>>,
}

impl std::fmt::Display for Layer {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.message)
    }
}

impl std::error::Error for Layer {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        self.source
            .as_deref()
            .map(|layer| layer as &(dyn std::error::Error + 'static))
    }
}

/// The whole point: `error decoding response body` on its own names
/// nothing, and the reset or h2 error underneath is only in the chain.
#[test]
fn the_error_chain_names_every_cause() {
    let error = Layer {
        message: "error decoding response body",
        source: Some(Box::new(Layer {
            message: "error reading a body from connection",
            source: Some(Box::new(Layer {
                message: "connection reset by peer (os error 104)",
                source: None,
            })),
        })),
    };
    assert_eq!(
        error_chain(&error),
        "error decoding response body: error reading a body from connection: connection reset by peer (os error 104)"
    );
}

#[test]
fn a_cause_already_quoted_by_its_parent_is_not_repeated() {
    let error = Layer {
        message: "outer: inner",
        source: Some(Box::new(Layer {
            message: "inner",
            source: None,
        })),
    };
    assert_eq!(error_chain(&error), "outer: inner");
}

#[test]
fn compression_is_anything_but_identity() {
    let facts = |encoding: Option<&str>| ConnectionFacts {
        status: 200,
        version: "HTTP/2.0".to_owned(),
        content_type: Some("text/event-stream".to_owned()),
        content_encoding: encoding.map(str::to_owned),
        transfer_encoding: None,
        server: None,
        request_id: None,
        resumed: false,
    };
    assert!(!facts(None).is_compressed());
    assert!(!facts(Some("identity")).is_compressed());
    assert!(!facts(Some("Identity")).is_compressed());
    assert!(facts(Some("gzip")).is_compressed());
    assert!(facts(Some("br")).is_compressed());
}

#[test]
fn the_preview_keeps_control_characters_on_one_line() {
    assert_eq!(preview(b"data: a\r\n\r\n"), "data: a\\r\\n\\r\\n");
    assert_eq!(preview(&[0xff, b'o', b'k']), "\u{fffd}ok");
}
