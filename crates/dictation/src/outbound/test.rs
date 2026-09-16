use super::*;
use crate::domain::AudioFormat;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};

#[tokio::test]
async fn posts_whisper_multipart_with_server_credential_and_reads_duration() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut bytes = Vec::new();
        let mut buffer = [0; 4096];
        loop {
            let read = socket.read(&mut buffer).await.unwrap();
            assert!(read > 0);
            bytes.extend_from_slice(&buffer[..read]);
            if let Some(end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&bytes[..end]).to_lowercase();
                let length: usize = headers
                    .lines()
                    .find_map(|line| line.strip_prefix("content-length: "))
                    .unwrap()
                    .parse()
                    .unwrap();
                if bytes.len() >= end + 4 + length {
                    break;
                }
            }
        }
        let request = String::from_utf8_lossy(&bytes);
        assert!(request.starts_with("POST /v1/audio/transcriptions "));
        assert!(
            request
                .to_lowercase()
                .contains("authorization: bearer test-server-key")
        );
        for expected in [
            "whisper-1",
            "verbose_json",
            "dictation.mp4",
            "audio/mp4",
            "test-audio",
            "name=\"language\"",
            "en",
        ] {
            assert!(request.contains(expected), "missing {expected}");
        }
        let body = r#"{"text":"Hello.","duration":2.5}"#;
        socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
    });
    let mut client = WhisperClient::new("test-server-key".into()).unwrap();
    client.endpoint = format!("http://{address}/v1/audio/transcriptions");
    let result = client
        .transcribe(Recording {
            bytes: b"test-audio".to_vec(),
            format: AudioFormat::Mp4,
            language: Some("en".into()),
        })
        .await
        .unwrap();
    assert_eq!(result.text, "Hello.");
    assert_eq!(result.duration_seconds, 2.5);
    server.await.unwrap();
}
