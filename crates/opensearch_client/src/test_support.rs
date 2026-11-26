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

/// One scripted answer from [`serve_script`].
pub(crate) enum Reply {
    /// Respond with a status line and JSON body.
    Respond(&'static str, &'static str),
    /// Close the connection without answering.
    Close,
}

/// Answer one request per entry of `replies`, in order, returning each
/// request's line, with its `x-opaque-id` header when it had one, and its body.
pub(crate) fn serve_script(
    replies: Vec<Reply>,
) -> (String, std::thread::JoinHandle<Vec<(String, String)>>) {
    use std::io::{BufRead, Read, Write};

    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let server = std::thread::spawn(move || {
        let mut seen = Vec::new();
        for reply in replies {
            let (mut stream, _) = listener.accept().unwrap();
            let mut reader = std::io::BufReader::new(&mut stream);
            let mut request = String::new();
            reader.read_line(&mut request).unwrap();
            let mut request = request.trim_end().to_owned();
            let mut content_length = 0;
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" {
                    break;
                }
                let lower = line.to_ascii_lowercase();
                if let Some(value) = lower.strip_prefix("content-length:") {
                    content_length = value.trim().parse::<usize>().unwrap();
                }
                if let Some(value) = lower.strip_prefix("x-opaque-id:") {
                    request.push_str(&format!(" x-opaque-id={}", value.trim()));
                }
            }
            let mut body = vec![0; content_length];
            reader.read_exact(&mut body).unwrap();
            seen.push((request, String::from_utf8(body).unwrap()));
            match reply {
                Reply::Respond(status, body) => {
                    write!(stream, "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
                }
                Reply::Close => drop(stream),
            }
        }
        seen
    });
    (url, server)
}

/// The local OpenSearch the ignored tests run against, with the search
/// indices created (`create_indices.ts`, which a local stack runs).
pub(crate) const LOCAL_OPENSEARCH: &str = "http://localhost:9200";

/// Create a scratch index with the live mapping of `alias`, so a test writes
/// nowhere real and the mapping stays the canonical one. It has several
/// shards, so routing matters as it does in a deployed index.
pub(crate) async fn scratch_index_like(
    client: &crate::OpensearchClient,
    alias: &str,
    prefix: &str,
) -> anyhow::Result<String> {
    let mappings: serde_json::Value = client
        .inner
        .indices()
        .get_mapping(opensearch::indices::IndicesGetMappingParts::Index(&[alias]))
        .send()
        .await?
        .error_for_status_code()?
        .json()
        .await?;
    let mapping = mappings
        .as_object()
        .and_then(|indices| indices.values().next())
        .map(|index| index["mappings"].clone())
        .ok_or_else(|| anyhow::anyhow!("{alias} has no mapping"))?;
    let index = format!("{prefix}-{}", uuid::Uuid::now_v7());
    client
        .ensure_index_exists(
            &index,
            serde_json::json!({
                "settings": {"number_of_shards": 3, "number_of_replicas": 0},
                "mappings": mapping,
            }),
        )
        .await?;
    Ok(index)
}

pub(crate) async fn refresh(client: &opensearch::OpenSearch, index: &str) -> anyhow::Result<()> {
    client
        .indices()
        .refresh(opensearch::indices::IndicesRefreshParts::Index(&[index]))
        .send()
        .await?
        .error_for_status_code()?;
    Ok(())
}

/// How many documents of `index` match `query`.
pub(crate) async fn count(
    client: &opensearch::OpenSearch,
    index: &str,
    query: serde_json::Value,
) -> anyhow::Result<u64> {
    let body: serde_json::Value = client
        .count(opensearch::CountParts::Index(&[index]))
        .body(serde_json::json!({ "query": query }))
        .send()
        .await?
        .error_for_status_code()?
        .json()
        .await?;
    body["count"]
        .as_u64()
        .ok_or_else(|| anyhow::anyhow!("no count in {body}"))
}

pub(crate) async fn delete_index(client: &opensearch::OpenSearch, index: &str) {
    let _ = client
        .indices()
        .delete(opensearch::indices::IndicesDeleteParts::Index(&[index]))
        .send()
        .await;
}
