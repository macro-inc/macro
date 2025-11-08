# Metering Service

A service for tracking and reporting AI service usage metrics.

## Configuration

Required environment variables:

- `DATABASE_URL`: PostgreSQL connection string
- `AUDIENCE`: JWT audience
- `PORT`: Service port (default: 8080)
- `ENVIRONMENT`: Environment (local/dev/prod)

## Development

Start the service:
```bash
cargo run
```

The service will be available at `http://localhost:8080` with Swagger documentation at `http://localhost:8080/docs`.
