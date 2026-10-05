use super::SyncServiceClient;
use anyhow::{Context, Result};

/// Initialization refused because the session already has its own snapshot.
#[derive(Debug)]
pub struct SnapshotAlreadyExists;

impl std::fmt::Display for SnapshotAlreadyExists {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("snapshot already exists")
    }
}

impl std::error::Error for SnapshotAlreadyExists {}

fn encode_initialize_from_snapshot_request(snapshot: &[u8]) -> Result<Vec<u8>> {
    let len = u32::try_from(snapshot.len()).with_context(|| {
        format!(
            "snapshot is too large to encode as sync-service initialize request: {} bytes",
            snapshot.len()
        )
    })?;

    let mut body = Vec::with_capacity(4 + snapshot.len());
    body.extend_from_slice(&len.to_le_bytes());
    body.extend_from_slice(snapshot);
    Ok(body)
}

impl SyncServiceClient {
    pub async fn initialize_from_snapshot(&self, document_id: &str, snapshot: &[u8]) -> Result<()> {
        let full_url = format!("{}/document/{}/initialize", self.url, document_id);
        let body = encode_initialize_from_snapshot_request(snapshot)?;
        let res = self
            .client
            .post(&full_url)
            .header(reqwest::header::CONTENT_TYPE, "application/octet-stream")
            .body(body)
            .timeout(std::time::Duration::from_secs(15))
            .send()
            .await?;

        let status_code = res.status();
        if status_code == reqwest::StatusCode::CONFLICT {
            return Err(SnapshotAlreadyExists.into());
        }
        if status_code != reqwest::StatusCode::OK {
            let body: String = res.text().await?;
            tracing::error!(
                body=%body,
                status=%status_code,
                "unexpected response from sync service while initializing snapshot"
            );
            anyhow::bail!(body);
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};

    use super::{
        SnapshotAlreadyExists, SyncServiceClient, encode_initialize_from_snapshot_request,
    };

    #[test]
    fn test_encode_initialize_from_snapshot_request() {
        let encoded = encode_initialize_from_snapshot_request(&[1, 2, 3]).unwrap();
        assert_eq!(encoded, vec![3, 0, 0, 0, 1, 2, 3]);
    }

    #[tokio::test]
    async fn existing_snapshot_is_a_typed_conflict() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                .unwrap();
            let mut request = Vec::new();
            let mut byte = [0];
            while !request.ends_with(b"\r\n\r\n") {
                stream.read_exact(&mut byte).unwrap();
                request.push(byte[0]);
            }
            let mut body = [0; 7];
            stream.read_exact(&mut body).unwrap();
            assert_eq!(body, [3, 0, 0, 0, 1, 2, 3]);
            stream
                .write_all(
                    b"HTTP/1.1 409 Conflict\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .unwrap();
        });
        let client =
            SyncServiceClient::new("local-test-key".to_string(), format!("http://{address}"));
        let error = client
            .initialize_from_snapshot("form-layout", &[1, 2, 3])
            .await
            .unwrap_err();
        server.join().unwrap();
        assert!(error.is::<SnapshotAlreadyExists>());
    }
}
