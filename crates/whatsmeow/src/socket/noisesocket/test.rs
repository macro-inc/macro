// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

use futures::{SinkExt, StreamExt};
use tokio_tungstenite::WebSocketStream;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::protocol::Role;

use super::*;
use crate::util::gcmutil::prepare;

const CLIENT_WRITE_KEY: [u8; 32] = [1; 32];
const CLIENT_READ_KEY: [u8; 32] = [2; 32];

async fn connected_noise_socket() -> (
    NoiseSocket,
    mpsc::Receiver<NoiseEvent>,
    WebSocketStream<tokio::io::DuplexStream>,
) {
    let (client, server) = tokio::io::duplex(1 << 16);
    let client = WebSocketStream::from_raw_socket(client, Role::Client, None).await;
    let server = WebSocketStream::from_raw_socket(server, Role::Server, None).await;
    let (frame_socket, frames) = FrameSocket::from_websocket(client);
    let (socket, events) = new_noise_socket(
        frame_socket,
        frames,
        prepare(&CLIENT_WRITE_KEY).unwrap(),
        prepare(&CLIENT_READ_KEY).unwrap(),
    );
    (socket, events, server)
}

#[test]
fn generate_iv_puts_the_counter_at_the_end() {
    assert_eq!(
        generate_iv(0x0102_0304),
        [0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4]
    );
}

#[tokio::test]
async fn send_frame_encrypts_with_an_incrementing_counter() {
    let (socket, _events, mut server) = connected_noise_socket().await;
    socket.send_frame(b"one").await.unwrap();
    socket.send_frame(b"two").await.unwrap();

    let key = prepare(&CLIENT_WRITE_KEY).unwrap();
    let Some(Ok(Message::Binary(first))) = server.next().await else {
        panic!("expected a binary message");
    };
    assert_eq!(first[..4], *b"WA\x06\x03");
    assert_eq!(
        gcmutil::open(&key, &generate_iv(0), &first[7..], &[]).unwrap(),
        b"one"
    );
    let Some(Ok(Message::Binary(second))) = server.next().await else {
        panic!("expected a binary message");
    };
    assert_eq!(
        gcmutil::open(&key, &generate_iv(1), &second[3..], &[]).unwrap(),
        b"two"
    );
}

#[tokio::test]
async fn received_frames_are_decrypted_and_bad_ones_skipped() {
    let (_socket, mut events, mut server) = connected_noise_socket().await;
    let key = prepare(&CLIENT_READ_KEY).unwrap();
    let first = gcmutil::seal(&key, &generate_iv(0), b"hello", &[]).unwrap();
    // Encrypted with the wrong counter, so it fails and is skipped.
    let bad = gcmutil::seal(&key, &generate_iv(0), b"bad", &[]).unwrap();
    let third = gcmutil::seal(&key, &generate_iv(2), b"world", &[]).unwrap();
    for ciphertext in [first, bad, third] {
        let mut message = vec![0, 0, u8::try_from(ciphertext.len()).unwrap()];
        message.extend_from_slice(&ciphertext);
        server.send(Message::Binary(message.into())).await.unwrap();
    }

    assert_eq!(
        events.recv().await,
        Some(NoiseEvent::Frame(b"hello".to_vec()))
    );
    assert_eq!(
        events.recv().await,
        Some(NoiseEvent::Frame(b"world".to_vec()))
    );
}

#[tokio::test]
async fn stop_with_disconnect_still_reports_the_disconnect_when_allowed() {
    let (socket, mut events, _server) = connected_noise_socket().await;
    socket.stop(true, true).await;
    assert_eq!(
        events.recv().await,
        Some(NoiseEvent::Disconnected { remote: false })
    );
    assert!(!socket.is_connected());
}

#[tokio::test]
async fn stop_without_on_disconnect_reports_nothing() {
    let (socket, mut events, _server) = connected_noise_socket().await;
    socket.stop(true, false).await;
    drop(socket);
    assert_eq!(events.recv().await, None);
}

#[tokio::test]
async fn remote_disconnect_is_forwarded() {
    let (_socket, mut events, mut server) = connected_noise_socket().await;
    server.close(None).await.unwrap();
    assert_eq!(
        events.recv().await,
        Some(NoiseEvent::Disconnected { remote: true })
    );
}
