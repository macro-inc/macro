use super::*;

const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0x00];

fn serve(status: &str, content_type: &str, body: &'static [u8]) -> String {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("a loopback port");
    let address = listener.local_addr().expect("a bound address");
    let status = status.to_owned();
    let content_type = content_type.to_owned();
    std::thread::spawn(move || {
        use std::io::{Read as _, Write as _};
        let (mut socket, _) = listener.accept().expect("the client connects");
        let mut buf = [0_u8; 1024];
        let _ = socket.read(&mut buf);
        let response = format!(
            "HTTP/1.1 {status}\r\ncontent-type: {content_type}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
            body.len()
        );
        let _ = socket.write_all(response.as_bytes());
        let _ = socket.write_all(body);
    });
    format!("http://{address}/pic")
}

#[tokio::test]
async fn a_png_response_becomes_a_prompt_image() {
    let url = serve("200 OK", "image/png", PNG);
    let image = HttpPromptImageFetcher::allowing_loopback()
        .fetch(&url)
        .await
        .expect("png");
    assert_eq!(image.mime_type, "image/png");
    assert_eq!(image.source_url.as_deref(), Some(url.as_str()));
    assert!(!image.data.is_empty());
}

#[tokio::test]
async fn an_html_page_is_not_an_image() {
    let url = serve("200 OK", "text/html", b"<html>not a picture</html>");
    assert!(
        HttpPromptImageFetcher::allowing_loopback()
            .fetch(&url)
            .await
            .is_none()
    );
}

#[tokio::test]
async fn a_loopback_link_is_refused_outside_tests() {
    let url = serve("200 OK", "image/png", PNG);
    assert!(HttpPromptImageFetcher::new().fetch(&url).await.is_none());
}

#[tokio::test]
async fn a_private_address_literal_is_refused() {
    assert!(
        !HttpPromptImageFetcher::new()
            .is_public("http://169.254.169.254/latest/meta-data")
            .await
    );
    assert!(
        !HttpPromptImageFetcher::new()
            .is_public("http://10.0.0.1/secret.png")
            .await
    );
    assert!(
        !HttpPromptImageFetcher::allowing_loopback()
            .is_public("http://10.0.0.1/secret.png")
            .await
    );
}
