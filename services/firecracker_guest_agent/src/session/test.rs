use std::collections::BTreeMap;
use std::os::unix::fs::MetadataExt;

use firecracker_host_api::exec::{ExecRequest, Frame, read_frame, write_frame};

use super::serve;

fn request(argv: &[&str]) -> ExecRequest {
    let metadata = std::fs::metadata("/proc/self").unwrap();
    ExecRequest {
        argv: argv.iter().map(|arg| (*arg).to_owned()).collect(),
        uid: metadata.uid(),
        gid: metadata.gid(),
        env: BTreeMap::from([("PATH".to_owned(), "/bin".to_owned())]),
        cwd: "/".to_owned(),
        trace_id: None,
    }
}

#[tokio::test]
async fn stdin_reaches_the_program_and_its_output_comes_back_before_the_exit() {
    let (host, guest) = tokio::io::duplex(1024);
    let session = tokio::spawn(serve(guest));
    let (mut from_guest, mut to_guest) = tokio::io::split(host);

    write_frame(
        &mut to_guest,
        &Frame::Start(request(&[
            "/bin/sh",
            "-c",
            "read -r line; printf %s \"$line\"; echo oops >&2; exit 3",
        ])),
    )
    .await
    .unwrap();
    write_frame(&mut to_guest, &Frame::Stdin(b"hello\n".to_vec()))
        .await
        .unwrap();
    write_frame(&mut to_guest, &Frame::CloseStdin)
        .await
        .unwrap();

    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    let exit = loop {
        match read_frame(&mut from_guest).await.unwrap().unwrap() {
            Frame::Stdout(bytes) => stdout.extend(bytes),
            Frame::Stderr(bytes) => stderr.extend(bytes),
            Frame::Exited(code) => break code,
            other => panic!("unexpected frame {other:?}"),
        }
    };

    assert_eq!(stdout, b"hello");
    assert_eq!(stderr, b"oops\n");
    assert_eq!(exit, 3);
    assert_eq!(read_frame(&mut from_guest).await.unwrap(), None);
    session.await.unwrap().unwrap();
}

#[tokio::test]
async fn a_missing_program_fails_instead_of_exiting() {
    let (host, guest) = tokio::io::duplex(1024);
    let session = tokio::spawn(serve(guest));
    let (mut from_guest, mut to_guest) = tokio::io::split(host);

    write_frame(
        &mut to_guest,
        &Frame::Start(request(&["/nonexistent/program"])),
    )
    .await
    .unwrap();

    let frame = read_frame(&mut from_guest).await.unwrap().unwrap();
    assert!(matches!(frame, Frame::Failed(_)), "{frame:?}");
    session.await.unwrap().unwrap();
}

#[tokio::test]
async fn closing_the_connection_kills_the_program() {
    let (host, guest) = tokio::io::duplex(1024);
    let session = tokio::spawn(serve(guest));
    let (mut from_guest, mut to_guest) = tokio::io::split(host);

    write_frame(
        &mut to_guest,
        &Frame::Start(request(&["/bin/sh", "-c", "echo started; read -r never"])),
    )
    .await
    .unwrap();
    assert_eq!(
        read_frame(&mut from_guest).await.unwrap(),
        Some(Frame::Stdout(b"started\n".to_vec()))
    );
    drop(to_guest);
    drop(from_guest);

    session.await.unwrap().unwrap();
}
