# OpenSearch Client

This is a client for interacting with OpenSearch.

## Usage

```rust
use opensearch_client::OpensearchClient;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let url = std::env::var("OPENSEARCH_URL").context("OPENSEARCH_URL not set")?;
    let username = std::env::var("OPENSEARCH_USERNAME")?;
    let password = std::env::var("OPENSEARCH_PASSWORD")?;

    let client = OpensearchClient::new(url, username, password)?;

    Ok(())
}
```

## Examples

For more examples, see the [examples directory](./examples).
