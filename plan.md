# Plan: Move GraphQL Soup document properties to a DataLoader edge

## Context

The `graphql_soup` crate currently exposes typed GraphQL Soup entities. `GraphqlSoupDocument` exposes `subType` and `properties` directly from the inline `models_soup::document::SoupDocument` payload.

We want `properties` to become a GraphQL edge resolved via DataLoader instead of reading the inline Soup payload. This decouples GraphQL property hydration from Soup item hydration and prepares the schema for reusable entity property edges.

Keep `subType` inline for now. It is intrinsic document metadata and does not need a DataLoader edge.

## Target GraphQL behavior

Frontend query should continue to look like:

```graphql
... on GraphqlSoupDocument {
  id
  name
  subType {
    kind
    isCompleted
  }
  properties {
    id
    displayName
    dataType
    value {
      kind
      stringValue
      selectOptionIds
    }
  }
}
```

But implementation should resolve `properties` through a DataLoader, not `SoupDocument.properties`.

## Design

### 1. Add reusable property edge key in `graphql_soup`

Use an entity-key shape, not document-only, so this can later support project/chat/email properties.

```rust
#[derive(Debug, Clone, Hash, PartialEq, Eq)]
pub struct EntityPropertiesKey {
    pub entity_type: String,
    pub entity_id: String,
}
```

For documents, build this from:

```rust
EntityPropertiesKey {
    entity_id: self.0.id.to_string(),
    entity_type: self.0.entity_type().to_string(),
}
```

Important: `SoupDocument::entity_type()` returns `Task` for task documents and `Document` otherwise, so this correctly supports task properties.

### 2. Add object-safe property reader trait in `graphql_soup`

Use `async_trait` to avoid pushing generics through every GraphQL type.

```rust
#[async_trait::async_trait]
pub trait SoupPropertyEdgeReader: Send + Sync + 'static {
    async fn get_properties(
        &self,
        keys: Vec<EntityPropertiesKey>,
    ) -> Result<HashMap<EntityPropertiesKey, Vec<SoupProperty>>, rootcause::Report>;
}
```

Add dependencies if needed:

```toml
async-trait = { workspace = true }
rootcause = { workspace = true }
```

### 3. Add DataLoader in `graphql_soup`

Enable async-graphql dataloader feature if needed. Current crate uses `async-graphql = "7.2.1"`; change to include dataloader support if required by this version.

Example shape:

```rust
use async_graphql::dataloader::{DataLoader, Loader};

pub struct EntityPropertiesLoader {
    reader: Arc<dyn SoupPropertyEdgeReader>,
}

impl EntityPropertiesLoader {
    pub fn new(reader: Arc<dyn SoupPropertyEdgeReader>) -> Self {
        Self { reader }
    }
}

#[async_trait::async_trait]
impl Loader<EntityPropertiesKey> for EntityPropertiesLoader {
    type Value = Vec<SoupProperty>;
    type Error = Arc<rootcause::Report>;

    async fn load(
        &self,
        keys: &[EntityPropertiesKey],
    ) -> Result<HashMap<EntityPropertiesKey, Self::Value>, Self::Error> {
        self.reader
            .get_properties(keys.to_vec())
            .await
            .map_err(Arc::new)
    }
}
```

Add a helper:

```rust
pub fn entity_properties_loader(
    reader: Arc<dyn SoupPropertyEdgeReader>,
) -> DataLoader<EntityPropertiesLoader> {
    DataLoader::new(EntityPropertiesLoader::new(reader), tokio::spawn)
}
```

This may require `tokio` as a dependency in `graphql_soup`.

### 4. Change `GraphqlSoupDocument.properties` resolver

Current resolver reads inline properties:

```rust
async fn properties(&self) -> Vec<GraphqlSoupProperty> {
    self.0.properties.iter().cloned().map(GraphqlSoupProperty).collect()
}
```

Change to use DataLoader:

```rust
async fn properties(&self, ctx: &Context<'_>) -> async_graphql::Result<Vec<GraphqlSoupProperty>> {
    let loader = ctx.data::<DataLoader<EntityPropertiesLoader>>()?;
    let key = EntityPropertiesKey {
        entity_id: self.0.id.to_string(),
        entity_type: self.0.entity_type().to_string(),
    };

    let properties = loader.load_one(key).await?.unwrap_or_default();
    Ok(properties.into_iter().map(GraphqlSoupProperty).collect())
}
```

Transition option: If wiring is incomplete, temporarily fall back to inline properties when loader is absent. Preferred final state is strict loader requirement.

### 5. Implement reader in `document_storage_service`

Implement `SoupPropertyEdgeReader` behind the existing `graphql` feature. The implementation should live in DSS or a DSS GraphQL module, not in `soup`.

Possible shape:

```rust
#[cfg(feature = "graphql")]
pub struct DssSoupPropertyEdgeReader {
    // Prefer existing properties service/repo if it has batch APIs.
    // Otherwise use PgPool/read-only pool and add/query a repository method.
}
```

Implementation target:

```rust
#[async_trait::async_trait]
impl graphql_soup::SoupPropertyEdgeReader for DssSoupPropertyEdgeReader {
    async fn get_properties(
        &self,
        keys: Vec<EntityPropertiesKey>,
    ) -> Result<HashMap<EntityPropertiesKey, Vec<SoupProperty>>, rootcause::Report> {
        // Batch fetch properties by entity_type/entity_id.
        // Return empty Vec for keys with no properties.
    }
}
```

Need to inspect existing `properties`, `properties_db_client`, or `system_properties` APIs for an appropriate batch lookup. If none exists, add a batch repo function to the appropriate properties crate.

### 6. Wire loader into DSS GraphQL request handler

Current GraphQL handler is in:

```text
rust/cloud-storage/document_storage_service/src/api/graphql_soup.rs
```

It currently injects:

```rust
request.data(GraphqlSoupRequestContext { ... })
```

Add:

```rust
.data(graphql_soup::entity_properties_loader(
    state.graphql_soup_property_reader.clone(),
))
```

This requires adding a property reader field to `ApiContext` under `#[cfg(feature = "graphql")]`, or including it in a small GraphQL state struct.

Example:

```rust
#[cfg(feature = "graphql")]
pub graphql_soup_property_reader: Arc<dyn graphql_soup::SoupPropertyEdgeReader>,
```

Construct it in `main.rs` when building `ApiContext`.

### 7. Keep crate boundaries clean

Dependency direction should remain:

```text
document_storage_service -> graphql_soup
document_storage_service -> properties/properties_db_client
graphql_soup -> models_soup/models_properties
soup -X-> graphql_soup
soup -X-> properties edge implementation
```

Do not make `soup` aware of GraphQL or the properties edge.

### 8. Validation

Run:

```bash
cd rust/cloud-storage
SQLX_OFFLINE=true cargo check -p graphql_soup
SQLX_OFFLINE=true cargo check -p document_storage_service --features graphql
SQLX_OFFLINE=true just check
SQLX_OFFLINE=true just clippy
just format
```

Note: `just clippy` has recently failed in this environment with an unrelated `sqlx_macros` / `aws_lc` undefined symbol. If it still fails, report that clearly and include successful checks.

## Acceptance criteria

- `GraphqlSoupDocument.properties` resolves via DataLoader.
- DataLoader batches property requests by `(entity_type, entity_id)`.
- Task documents use `entity_type = task`, normal documents use `entity_type = document`.
- Frontend GraphQL field shape remains `properties { ... }`.
- `SoupDocument.properties` is no longer read by the GraphQL resolver.
- Existing REST Soup API remains unchanged.
- GraphQL remains behind `document_storage_service` feature `graphql`, default off.
