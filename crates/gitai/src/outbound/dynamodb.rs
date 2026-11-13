use crate::domain::ports::IndexStore;

/// The service's single table: string keys `pk`/`sk`, one global secondary
/// index `gsi1` on `gsi1pk`/`gsi1sk`, and TTL on `expires_at` (epoch seconds).
pub struct DynamoIndex {
    #[expect(dead_code, reason = "used by the index reads and writes")]
    client: aws_sdk_dynamodb::Client,
    #[expect(dead_code, reason = "used by the index reads and writes")]
    table: String,
}

impl DynamoIndex {
    /// The index stored in `table`.
    pub fn new(client: aws_sdk_dynamodb::Client, table: String) -> Self {
        Self { client, table }
    }
}

impl IndexStore for DynamoIndex {}
