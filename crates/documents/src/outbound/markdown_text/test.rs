use super::*;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;

#[tokio::test]
async fn live_markdown_is_read_in_the_lossless_internal_format() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut reader = BufReader::new(stream.try_clone().unwrap());
        let mut line = String::new();
        reader.read_line(&mut line).unwrap();
        assert_eq!(line.trim_end(), "GET /markdown/doc-1?target=internal HTTP/1.1");
        loop {
            line.clear();
            reader.read_line(&mut line).unwrap();
            if line == "\r\n" || line.is_empty() {
                break;
            }
        }
        let body = r#"{"data":"Owner: <m-user-mention>{}</m-user-mention>"}"#;
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
        .unwrap();
    });
    let client = LexicalClient::new("test-key".to_owned(), format!("http://{address}"));

    assert_eq!(
        client.markdown("doc-1").await.unwrap(),
        "Owner: <m-user-mention>{}</m-user-mention>"
    );
    server.join().unwrap();
}
