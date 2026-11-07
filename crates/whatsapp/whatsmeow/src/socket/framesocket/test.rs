// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

use futures::{SinkExt, StreamExt};
use tokio_tungstenite::WebSocketStream;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::protocol::Role;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;

use super::*;

#[test]
fn process_data_splits_batched_frames() {
    let mut assembler = FrameAssembler::default();
    let frames = assembler.process_data(&[0, 0, 2, b'h', b'i', 0, 0, 0, 0, 0, 1, b'!']);
    assert_eq!(frames, vec![b"hi".to_vec(), Vec::new(), b"!".to_vec()]);
}

#[test]
fn process_data_joins_frames_split_across_messages() {
    let mut assembler = FrameAssembler::default();
    assert_eq!(
        assembler.process_data(&[0, 0, 5, b'w', b'h']),
        Vec::<Vec<u8>>::new()
    );
    assert_eq!(assembler.process_data(b"a"), Vec::<Vec<u8>>::new());
    assert_eq!(
        assembler.process_data(&[b't', b's', 0, 0, 1, b'x']),
        vec![b"whats".to_vec(), b"x".to_vec()]
    );
}

#[test]
fn process_data_keeps_a_partial_length_prefix() {
    let mut assembler = FrameAssembler::default();
    assert_eq!(assembler.process_data(&[0, 0]), Vec::<Vec<u8>>::new());
    assert_eq!(
        assembler.process_data(&[3, b'a', b'b']),
        Vec::<Vec<u8>>::new()
    );
    assert_eq!(assembler.process_data(b"c"), vec![b"abc".to_vec()]);
}

async fn connected_pair() -> (
    FrameSocket,
    mpsc::Receiver<FrameEvent>,
    WebSocketStream<tokio::io::DuplexStream>,
) {
    let (client, server) = tokio::io::duplex(1 << 16);
    let client = WebSocketStream::from_raw_socket(client, Role::Client, None).await;
    let server = WebSocketStream::from_raw_socket(server, Role::Server, None).await;
    let (socket, events) = FrameSocket::from_websocket(client);
    (socket, events, server)
}

#[tokio::test]
async fn send_frame_prefixes_the_header_once_and_the_length_always() {
    let (socket, _events, mut server) = connected_pair().await;
    assert_eq!(socket.header().await, Some(b"WA\x06\x03".to_vec()));

    socket.send_frame(b"first").await.unwrap();
    socket.send_frame(b"second").await.unwrap();

    assert_eq!(
        server.next().await.unwrap().unwrap(),
        Message::Binary(b"WA\x06\x03\x00\x00\x05first".to_vec().into())
    );
    assert_eq!(
        server.next().await.unwrap().unwrap(),
        Message::Binary(b"\x00\x00\x06second".to_vec().into())
    );
    assert_eq!(socket.header().await, None);
}

#[tokio::test]
async fn received_messages_become_frame_events() {
    let (_socket, mut events, mut server) = connected_pair().await;
    server
        .send(Message::Binary(b"\x00\x00\x03abc\x00\x00".to_vec().into()))
        .await
        .unwrap();
    server
        .send(Message::Binary(b"\x02de".to_vec().into()))
        .await
        .unwrap();

    assert_eq!(
        events.recv().await,
        Some(FrameEvent::Frame(b"abc".to_vec()))
    );
    assert_eq!(events.recv().await, Some(FrameEvent::Frame(b"de".to_vec())));
}

#[tokio::test]
async fn remote_close_is_a_remote_disconnect() {
    let (socket, mut events, mut server) = connected_pair().await;
    server.close(None).await.unwrap();

    assert_eq!(
        events.recv().await,
        Some(FrameEvent::Disconnected { remote: true })
    );
    assert!(!socket.is_connected());
    assert!(matches!(
        socket.send_frame(b"late").await,
        Err(SocketError::SocketClosed)
    ));
}

#[tokio::test]
async fn local_close_with_a_code_is_a_local_disconnect_once() {
    let (socket, mut events, mut server) = connected_pair().await;
    socket.close(Some(CloseCode::Normal)).await;
    socket.close(Some(CloseCode::Normal)).await;

    assert!(matches!(
        server.next().await,
        Some(Ok(Message::Close(Some(frame)))) if frame.code == CloseCode::Normal
    ));
    assert_eq!(
        events.recv().await,
        Some(FrameEvent::Disconnected { remote: false })
    );
    drop(socket);
    assert_eq!(events.recv().await, None);
}

#[tokio::test]
async fn send_frame_rejects_oversized_frames() {
    let (socket, _events, _server) = connected_pair().await;
    assert!(matches!(
        socket.send_frame(&vec![0; FRAME_MAX_SIZE]).await,
        Err(SocketError::FrameTooLarge {
            length: FRAME_MAX_SIZE
        })
    ));
}
