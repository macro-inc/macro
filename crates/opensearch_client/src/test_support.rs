//! Helpers shared by this crate's tests.

/// Answer one request with `status` and `body`, returning its request line and
/// body as received.
pub(crate) fn serve_once(
    status: &'static str,
    body: &'static str,
) -> (String, std::thread::JoinHandle<(String, String)>) {
    use std::io::{BufRead, Read, Write};

    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut reader = std::io::BufReader::new(&mut stream);
        let mut request_line = String::new();
        reader.read_line(&mut request_line).unwrap();
        let mut content_length = 0;
        loop {
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            if line == "\r\n" {
                break;
            }
            if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                content_length = value.trim().parse::<usize>().unwrap();
            }
        }
        let mut request_body = vec![0; content_length];
        reader.read_exact(&mut request_body).unwrap();
        write!(stream, "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
        (request_line, String::from_utf8(request_body).unwrap())
    });
    (url, server)
}
