# Testing Guide for Metering Service

This guide explains how to run tests for the metering service.

## Prerequisites

1. **PostgreSQL Database**: Ensure PostgreSQL is running locally on port 5432
2. **Test Database**: Create a test database called `metering_test`
3. **Test User**: Ensure the `user` with password `password` has access

## Database Setup

```bash
# Create test database (run this once)
just create_test_db

# Run migrations
just migrate_test_db

# Or setup everything in one command
just setup_test_db
```

## Running Tests

### Run All Tests
```bash
# Run tests with database reset
just test_db

# Or run tests directly (assumes DB is already setup)
cargo test
```

### Run Specific Test Categories

```bash
# Database layer tests only
cargo test db::

# API endpoint tests only  
cargo test api::

# Integration tests only
cargo test integration_tests

# Specific test function
cargo test test_create_usage_record
```

### Run Tests with Logging
```bash
RUST_LOG=debug cargo test -- --nocapture
```

## Test Structure

### Database Tests (`tests/db/`)
- **test_metering_db.rs**: Tests for the MeteringDb layer
  - Creating usage records
  - Querying with filters
  - Pagination
  - Date range filtering
  - Usage summaries and aggregation

### API Tests (`tests/api/`)
- **test_usage_endpoints.rs**: Tests for usage tracking endpoints
  - POST /usage (create records)
  - GET /usage (query records with filters)
  - GET /usage/summary (aggregate reports)
- **test_health.rs**: Tests for health check endpoint

### Integration Tests (`tests/integration_tests.rs`)
- Full workflow testing
- Multi-user scenarios
- Cost aggregation accuracy
- Pagination consistency
- Sample fixture loading

## Test Utilities (`tests/common/`)

### Database Setup
- `setup_test_db()`: Creates clean test database connection
- Automatically runs migrations
- Cleans existing data between tests

### Test Data Factories
- `create_test_usage_request()`: Creates realistic usage record
- `create_test_usage_request_with_user(user_id)`: Creates record for specific user
- `create_test_usage_request_minimal()`: Creates minimal record with no optional fields

### Sample Fixtures (`tests/fixtures/`)
- `sample_usage_records.json`: Realistic test data for various AI services

## Test Configuration

### Environment Variables
Tests use `.env.test` file with the following settings:
- `DATABASE_URL`: Test database connection
- `RUST_LOG`: Logging level for tests
- `JWT_SECRET_KEY`: Test JWT secret

### Serial Test Execution
Tests are marked with `#[serial]` to prevent database conflicts when running concurrently.

## Test Coverage

The test suite covers:

### Database Layer
- ✅ Record creation with all field types
- ✅ Query filtering by user, organization, project, service, date range
- ✅ Pagination (limit/offset)
- ✅ Usage aggregation and summaries
- ✅ Cost calculation accuracy

### API Layer  
- ✅ All endpoint functionality
- ✅ Request validation
- ✅ Error handling
- ✅ Response format validation
- ✅ Query parameter parsing

### Integration
- ✅ Full workflow from creation to reporting
- ✅ Multi-user data isolation
- ✅ Complex filtering scenarios
- ✅ Data consistency across operations

## Troubleshooting

### Database Connection Issues
```bash
# Check if PostgreSQL is running
sudo systemctl status postgresql

# Check if test database exists
psql -U user -h localhost -p 5432 -l | grep metering_test

# Reset test database if needed
just reset_test_db
```

### Migration Issues
```bash
# Check migration status
DATABASE_URL=postgres://user:password@localhost:5432/metering_test sqlx migrate info

# Force reset migrations
just drop_test_db
just setup_test_db
```

### Test Failures
- Tests use `serial_test` to avoid conflicts
- Each test starts with a clean database state
- Check logs with `RUST_LOG=debug` for detailed error information

## Adding New Tests

### Database Tests
1. Add to `tests/db/test_metering_db.rs`
2. Use `#[serial]` annotation
3. Call `setup_test_db()` for clean state
4. Use test data factories from `common`

### API Tests
1. Add to appropriate file in `tests/api/`
2. Use `TestServer` for HTTP testing
3. Create test app with `create_test_app(db)`
4. Validate both success and error cases

### Integration Tests
1. Add to `tests/integration_tests.rs`
2. Test complete workflows
3. Use realistic data scenarios
4. Verify cross-component behavior