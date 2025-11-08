# Properties Service Client

A client library for service-to-service communication with the Properties Service.

## Overview

This client provides internal methods for other services to interact with the Properties Service API. It uses internal authentication for trusted service-to-service communication.

## Supported Endpoints

The client supports the following internal endpoint:

### Bulk Get Entity Properties
- **Endpoint**: `GET /internal/properties/entities/bulk`
- Retrieve properties for multiple entities at once

## Usage

```rust
use properties_service_client::PropertiesServiceClient;

// Create client
let client = PropertiesServiceClient::new(
    "your-internal-auth-key".to_string(),
    "http://properties-service-url".to_string(),
);

// Get bulk entity properties from entity IDs
let entity_ids = vec!["entity-1".to_string(), "entity-2".to_string()];
let bulk_properties = client.get_bulk_entity_properties_by_ids(entity_ids).await?;
```

## Error Handling

The client uses `anyhow::Result` for simple and consistent error handling. All HTTP errors are converted to `anyhow::Error` with the status code and response body.

## Authentication

This client is designed for **internal service-to-service communication** and uses internal authentication keys. For user-facing applications, call the Properties Service directly with JWT authentication. 