use std::collections::BTreeMap;

use super::*;

#[tokio::test]
async fn frames_survive_a_stream_and_end_cleanly() {
    let frames = vec![
        Frame::Start(ExecRequest {
            argv: vec![
                "systemctl".to_owned(),
                "restart".to_owned(),
                "macrod".to_owned(),
            ],
            uid: 0,
            gid: 0,
            env: BTreeMap::from([("PATH".to_owned(), "/run/current-system/sw/bin".to_owned())]),
            cwd: "/".to_owned(),
            trace_id: None,
        }),
        Frame::Stdin(b"input".to_vec()),
        Frame::CloseStdin,
        Frame::Stdout(Vec::new()),
        Frame::Stderr(b"warning".to_vec()),
        Frame::Exited(-1),
        Frame::Failed("guest went away".to_owned()),
    ];
    let mut stream = Vec::new();
    for frame in &frames {
        write_frame(&mut stream, frame).await.unwrap();
    }

    let mut reader = stream.as_slice();
    let mut read = Vec::new();
    while let Some(frame) = read_frame(&mut reader).await.unwrap() {
        read.push(frame);
    }

    assert_eq!(read, frames);
}

#[tokio::test]
async fn an_oversized_length_is_refused_before_allocating() {
    let mut stream = (MAX_FRAME_BYTES + 1).to_be_bytes().to_vec();
    stream.push(STDOUT);

    let error = read_frame(&mut stream.as_slice()).await.unwrap_err();

    assert!(matches!(error, FrameError::TooLarge(length) if length == MAX_FRAME_BYTES + 1));
}

#[test]
fn unknown_kinds_and_short_exit_codes_do_not_decode() {
    assert!(matches!(
        Frame::decode(&[9]),
        Err(FrameError::UnknownKind(9))
    ));
    assert!(matches!(
        Frame::decode(&[EXITED, 0, 1]),
        Err(FrameError::Payload(_))
    ));
    assert!(matches!(Frame::decode(&[]), Err(FrameError::Empty)));
}
