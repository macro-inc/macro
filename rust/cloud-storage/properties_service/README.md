# Properties Service

A service for managing custom properties that can be attached to various entities (documents, chats, projects, etc.). Refactored to follow **hexagonal architecture** pattern.

## Architecture

This service implements hexagonal architecture (ports and adapters):

```
Inbound → Domain ← Outbound
(HTTP)   (Logic)  (Database)
```

For detailed architecture documentation, see [HEXAGONAL_ARCHITECTURE.md](./HEXAGONAL_ARCHITECTURE.md).

## Quick Start

### Running Locally

```bash
# From the cloud-storage directory
cargo run --bin properties_service

# With local auth
cargo run --bin properties_service --features local_auth
```

### API Endpoints

All endpoints use hexagonal architecture handlers:

**Property Definitions:**
- `POST /properties/definitions` - Create property definition
- `GET /properties/definitions` - List property definitions
- `GET /properties/definitions/:id` - Get property definition by ID
- `DELETE /properties/definitions/:id` - Delete property definition

**Property Options:**
- `GET /properties/definitions/:definition_id/options` - Get options for a property
- `POST /properties/definitions/:definition_id/options` - Create option
- `DELETE /properties/definitions/:definition_id/options/:option_id` - Delete option

**Entity Properties:**
- `GET /properties/entities/:entity_type/:entity_id` - Get properties for an entity
- `PUT /properties/entities/:entity_type/:entity_id/:property_id` - Set entity property value
- `DELETE /properties/entity_properties/:entity_property_id` - Delete entity property

**Internal Endpoints:**
- `DELETE /internal/properties/entities/:entity_type/:entity_id` - Delete all properties for an entity
- `POST /internal/properties/entities/bulk` - Get properties for multiple entities

## Project Structure

```
src/
├── domain/           # Business logic (pure, no external deps)
│   ├── models/       # Domain entities (uses models_properties::service)
│   │   ├── extensions.rs  # Domain behavior (validation, constructors)
│   │   ├── requests.rs     # Domain request models
│   │   └── responses.rs   # Domain response models
│   ├── ports/        # Trait interfaces (service_port, storage_port)
│   ├── services/     # Business logic (PropertyServiceImpl)
│   └── error.rs      # Domain error types
├── outbound/         # Infrastructure implementations
│   ├── postgres/     # PostgreSQL storage adapter
│   │   ├── mod.rs    # PropertiesPgStorage implementation
│   │   ├── definitions.rs  # Property definition operations
│   │   └── options.rs      # Property option operations
│   └── permission_checker.rs  # Permission checking adapter
├── inbound/          # Entry points
│   └── http.rs       # HTTP handlers (converts API ↔ domain)
├── api/              # API routing and setup
│   ├── mod.rs        # Route definitions
│   ├── swagger.rs    # OpenAPI documentation
│   └── context.rs    # ApiContext with services
└── main.rs           # Composition root
```

## Key Features

### Domain Models

- `PropertyDefinition`: Reusable property that can be attached to entities
- `PropertyOption`: Options for select-type properties
- `DataType`: Boolean, Date, Number, String, SelectString, SelectNumber, Entity, Link
- `EntityType`: Document, Chat, Project, Thread, Channel, User
- `PropertyOwner`: Organization-scoped or user-scoped properties

### Business Rules

- Property definitions can be owned by organizations or users
- Select types require options
- Multi-select only allowed for select types and entity references
- Entity type properties must specify entity type
- Permission checks for property CRUD operations
- Permission checks for setting entity properties

### Services

- `PropertyService`: Unified service for all property operations
  - Property definitions (create, list, delete)
  - Property options (create, get, delete)
  - Entity properties (get, set, delete, bulk operations)

### Storage & Permissions

- `PropertiesStorage`: Unified storage adapter for all persistence operations
- `PermissionChecker`: Authorization checks for property and entity operations

## Testing

### Unit Tests

Test domain logic with mocks:

```bash
cargo test --package properties_service
```

### Integration Tests

Test with real database:

```bash
# Uses sqlx test fixtures
cargo test --package properties_service
```

## Development

### Adding a New Feature

1. Define domain request/response models in `src/domain/models/requests.rs` and `responses.rs`
2. Add service method to `PropertyService` trait in `src/domain/service_port.rs`
3. Implement service method in `PropertyServiceImpl` in `src/domain/services/property_service.rs`
4. Add storage methods to `PropertiesStorage` trait if needed in `src/domain/storage_port.rs`
5. Implement storage methods in `PropertiesPgStorage` in `src/outbound/postgres/`
6. Create HTTP handler in `src/inbound/http.rs` (converts API models ↔ domain models)
7. Wire route in `src/api/mod.rs`

Example:

```rust
// 1. Domain request/response models
pub struct ArchivePropertyRequest {
    pub property_id: Uuid,
    pub owner: PropertyOwner,
}

pub struct ArchivePropertyResponse {}

// 2. Add to PropertyService trait
async fn archive_property(&self, request: ArchivePropertyRequest) -> Result<ArchivePropertyResponse>;

// 3. Implement in PropertyServiceImpl
async fn archive_property(&self, request: ArchivePropertyRequest) -> Result<ArchivePropertyResponse> {
    // Business logic + storage calls
}

// 4. Add storage method if needed
async fn archive_property_definition(&self, id: Uuid) -> Result<(), Self::Error>;

// 5. Implement in PropertiesPgStorage
// (direct SQL queries)

// 6. HTTP handler
pub async fn archive_property(
    State(service): State<Arc<PropertyServiceImpl<...>>>,
    Extension(user_context): Extension<UserContext>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, HttpError> {
    let request = ArchivePropertyRequest {
        property_id: id,
        owner: PropertyOwner::from_optional_ids(...)?,
    };
    service.archive_property(request).await?;
    Ok(StatusCode::NO_CONTENT)
}

// 7. Add route
.route("/definitions/:id/archive", post(archive_property))
```

### Code Style

- Domain layer: Pure Rust, no external dependencies
- Services: Generic over trait bounds
- Adapters: Implement trait interfaces
- Errors: Domain errors, not infrastructure errors
- Tests: Unit tests for services, integration tests for adapters

## Dependencies

- `sqlx`: Database access (direct SQL queries in storage adapter)
- `axum`: HTTP server
- `models_properties`: Shared types (service layer = domain models, api layer = API contracts)
- `comms_service_client`: For channel permissions
- `macro_middleware`: Permission checking utilities

## Environment Variables

See `src/config.rs` for configuration options.

Required:
- `DATABASE_URL`: PostgreSQL connection string
- `PORT`: HTTP server port (default: 8080)
- `ENVIRONMENT`: dev | production | local

## Database

### Migrations

Managed by `macro_db_client/migrations/`:

- Property definitions table
- Property options table
- Entity properties table

### Schema

```sql
CREATE TABLE property_definitions (
    id UUID PRIMARY KEY,
    organization_id INT,
    user_id TEXT,
    display_name TEXT NOT NULL,
    data_type property_data_type NOT NULL,
    is_multi_select BOOLEAN NOT NULL,
    specific_entity_type property_entity_type,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE property_options (
    id UUID PRIMARY KEY,
    property_definition_id UUID NOT NULL REFERENCES property_definitions(id),
    display_order INT NOT NULL,
    number_value DOUBLE PRECISION,
    string_value TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE entity_properties (
    id UUID PRIMARY KEY,
    entity_id TEXT NOT NULL,
    entity_type property_entity_type NOT NULL,
    property_definition_id UUID NOT NULL REFERENCES property_definitions(id),
    values JSONB,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);
```

## Monitoring

- Tracing: All service methods instrumented with `#[tracing::instrument]`
- Logging: Structured logs via `tracing`
- Errors: Logged with context at appropriate levels

## Future Work

- [ ] Add caching layer for property definitions
- [ ] Add GraphQL API alongside HTTP
- [ ] Add property templates
- [ ] Add property validation rules
- [ ] Add property archiving/soft delete

## Related Services

- `models_properties`: Shared types (service = domain models, api = API contracts)
- `comms_service`: Channel permissions

## References

- [Hexagonal Architecture Documentation](./HEXAGONAL_ARCHITECTURE.md)
- [Frecency Service](../frecency/) - Another hexagonal service example
- [Soup Service](../soup/) - Another hexagonal service example
