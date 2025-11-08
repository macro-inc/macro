# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture Overview

This is a Rust-based cloud storage microservices architecture built as a Cargo workspace with 80+ crates. The system
handles document storage, processing, search, communication, and email functionality.
When making changes, make sure to test the services individually before committing using `cargo test -p {my_service}`
from the cloud-storage folder.

### Key Services

**Core Storage Services:**

- `document-storage-service`: Main document storage API
- `document-cognition-service`: Document analysis and processing
- `search_service`: Search functionality across documents
- `static_file_service`: Static file serving

**Processing Services:**

- `convert_service`: Document format conversion
- `document-text-extractor`: Text extraction from documents
- `search_processing_service`: Search indexing and processing

**Communication Services:**

- `comms_service`: Internal communication handling
- `email_service`: Email processing and management
- `notification_service`: User notifications

**Infrastructure Services:**

- `authentication_service`: User authentication
- `connection_gateway`: WebSocket gateway
- `contacts_service`: Contact management

### Data Storage

The system uses multiple databases:

- **MacroDB**: Main PostgreSQL database for documents, users, projects, Communication data (messages, channels,
  participants), Email threads, messages, and metadata
- **NotificationDB**: Notification preferences and history
- **ContactsDB**: User connections and contacts

External storage includes S3 for document files, Redis for caching, OpenSearch for search indexing, and DynamoDB for
connection tracking.

### MacroDB Schema Changes

The schema for MacroDB is defined in `macro-api/database/schema.prisma` Prisma schema file.
After making changes to the schema, run `just create-migration` from the `macro-api/database` folder to generate a
migration file.
You will need to supply a name for the migration as an argument to the command. This will apply the migration to the
locally running database.
Afterwards, run `just setup_macrodb` in `macro-api/cloud-storage` and `just prepare_db` in
`macro-api/cloud-storage/macro_db_client`
to update the .sqlx and migrations directory for Rust macro_db_client.
If you are still getting migration errors after running `just setup_macrodb`, you may need to run `just force_drop_db`
in `macro-api/cloud-storage/macro_db_client` to drop the database and re-create it
with `just setup_macrodb` in `macro-api/cloud-storage`. Remember that when you are reading the database columsn, the
names are camelCased and not snake_cased (refer to the `schema.prisma` file for the actual column names).
So you need to cast as the snake_cased version of the column name when reading from the database. E.g.
`SELECT "userId" as "user_id" FROM "UserInsights"`.
Any time you make changes to the SQL code in rust, you need to run `just prepare_db` in
`macro-api/cloud-storage/macro_db_client` to update the .sqlx.

## Development Commands

### Alias Commands (IMPORTANT)

Use `\cd` instead of `cd` to navigate in the repository.

### Building

```bash
just build                    # Build all services
just build_lambdas           # Build all Lambda functions
just check                   # Type check without building
```

### Testing

```bash
# Setup test environment
docker-compose up -d macrodb
just setup_test_envs         # Setup .env files for tests
just initialize_dbs          # Initialize all databases
just test                    # Run tests
```

### Database Management

```bash
just setup_macrodb           # Setup main database
just setup_commsdb           # Setup communications database
just setup_notificationdb   # Setup notifications database
just setup_emaildb           # Setup email database
just setup_contactsdb        # Setup contacts database
```

### Lambda Building

Individual lambda builds available for:

- `build_document_text_extractor`
- `build_docx_unzip_handler`
- `build_delete_chat_handler`
- `build_upload_extractor_lambda_handler`
- `build_email_suppression`
- `build_deleted_item_poller`

## Key Architectural Patterns

### Service Communication

Services communicate via:

- HTTP APIs (internal service clients)
- SQS queues for async processing
- Lambda triggers for event-driven processing
- Redis for caching and session management

### Database Architecture

- Each service has its own database client crate (e.g., `macro_db_client`, `comms_db_client`)
- Uses SQLx for database interactions with offline query validation
- Migrations managed per service

### AWS Integration

Heavy use of AWS services:

- S3 for file storage
- Lambda for serverless processing
- SQS for message queuing
- DynamoDB for connection tracking
- OpenSearch for search capabilities

## Development Notes

### Prerequisites

- Docker (for local databases)
- `sqlx-cli` for database migrations
- `just` for task running
- Pulumi CLI for infrastructure
- AWS CLI for deployment

### Offline Development

The project uses `SQLX_OFFLINE=true` for building without database connections. Database queries are pre-validated and
cached.

### Document Processing Pipeline

Documents go through: Upload → Text Extraction → Search Indexing → Storage → Retrieval

- DOCX files are unzipped via Lambda
- PDFs processed with pdfium library
- Text indexed in OpenSearch
- Metadata stored in PostgreSQL

## Case Study: Implementing Generic Entity Mentions

This case study documents the process of extending message mentions to support generic entity mentions (e.g., documents
mentioning other documents).

### Task Understanding & Planning

1. **Analyzed Requirements**: Extended existing MessageMention functionality to support any entity mentioning any other
   entity
2. **Created Todo List**: Used TodoWrite tool to track implementation steps
3. **Examined Existing Code**: Reviewed current message_mentions table structure and usage

### Implementation Steps

1. **Data Model Changes**
    - Created `EntityMention` struct with generic source/target fields
    - Maintained backward compatibility with existing mentions

2. **Database Migration**
    - Renamed `message_mentions` → `entity_mentions`
    - Added `source_entity_type` and `source_entity_id` columns
    - Migrated existing data (messages) to new structure
    - Updated all indexes for performance

3. **Updated Database Client**
    - Created `entity_mentions` module with create/delete functions
    - Modified `get_attachment_references` to query new table
    - Updated `create_message_mentions` to insert into new table
    - Fixed test fixtures to use new table structure

4. **API Endpoints**
    - Created POST/DELETE `/entity-mentions` endpoints
    - Used proper Extension extractors for axum handlers
    - Added OpenAPI documentation

### Testing & Debugging

1. **Compilation Issues**
    - Fixed import errors (wrong Context type, missing http import)
    - Added Clone trait to structs used in tests
    - Updated fixture references from `message_mentions` to `mentions`

2. **Test Failures**
    - Fixed `create_message_mentions` test by updating query logic
    - Query now returns all mentioned users, not just newly inserted ones
    - Updated fixtures to include entity_mentions data

3. **SQLX Offline Mode**
    - Encountered "no cached data" errors due to schema changes
    - Required running migrations before `cargo sqlx prepare`

### Database Preparation

1. Run migrations: `just migrate_db`
2. Update SQLX cache: `just prepare_db`
3. Verify with tests: `cargo test`

### Key Learnings

1. **Todo Management**: Proactive use of TodoWrite helps track complex multi-step tasks
2. **Incremental Testing**: Run tests frequently to catch issues early
3. **Fixture Management**: Update test fixtures when changing table structures
4. **SQLX Workflow**: Schema changes require migration → prepare → test cycle
5. **Axum Patterns**: Use Extension instead of State for handlers in this codebase

### Index Strategy

The migration included comprehensive indexes:

- Composite index on (entity_type, entity_id) for efficient lookups
- Index on source columns for reverse lookups
- Index on created_at for ordering
- Maintained existing performance optimizations

## Development Best Practices

### Database Query Management

- Always run tests between changes that involve changes to db queries

## Development Memories

### DB Crate Changes

- When making changes to a db crate you should always update tests, and run prepare
  ||||||| efd8fa30
- Metadata stored in PostgreSQL
  =======
