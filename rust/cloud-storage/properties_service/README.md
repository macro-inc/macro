# Properties Service

A REST API service for managing entity properties and property definitions.

## Overview

The Properties Service provides endpoints for:
- Creating and managing property definitions for organizations
- Managing property options (for dropdown/select properties)
- Assigning property values to entities (documents, users, channels, projects, threads)
- Retrieving entity properties

## API Endpoints

### Property Definition Management
- `GET /properties/organizations/{organizationId}/properties` - List organization's properties
- `GET /properties/users/me/properties` - List user's personal properties
- `POST /properties/definitions` - Create new property (organization or user-scoped based on payload)
- `DELETE /properties/properties/{id}` - Delete property definition

### Property Options Management (for custom selects)
- `GET /properties/properties/{id}/options` - Get options for dropdowns
- `POST /properties/properties/{id}/options` - Add new option to dropdown
- `DELETE /properties/options/{id}` - Delete property option

### Entity Property Assignment
- `GET /properties/entities/{entityId}/properties?entity_type={type}` - Get entity's current properties
- `PUT /properties/entities/{entityId}/properties/{propertyId}?entity_type={type}` - Set/update property value
- `DELETE /properties/entities/{entityId}/properties/{propertyId}` - Remove property from entity

## Usage Examples

### Create Organization Property
```json
POST /properties/definitions
{
  "organization_id": "org-123",
  "display_name": "Project Status",
  "data_type": "String",
  "is_multi_select": false,
  "options": []
}
```

### Create User Property  
```json
POST /properties/definitions
{
  "display_name": "Personal Tag",
  "data_type": "String",
  "is_multi_select": true,
  "options": []
}
```

## Building & Running Locally

```bash
SQLX_OFFLINE=true cargo build
```

```bash
cargo run --features local_auth 
```

The `local_auth` feature will automatically inject a valid JWT token into the request header.
To set the user_id you can set the `LOCAL_USER_ID` environment variable.

## API Documentation

Once running, you can access the Swagger UI documentation at:
`http://localhost:8080/docs`

## Architecture

The Properties Service follows a clean, direct architecture:
- **API Handlers** → **Database Client** (direct calls to `properties_db_client`)
- No service layer - handlers call database operations directly for consistency with other services
- Business logic is contained within handlers and helper modules

### Helper Modules
- `metadata.rs` - Document metadata system properties
- `value_processing.rs` - Property value processing and validation
- `types.rs` - System property value types

## Dependencies

- Database: PostgreSQL (via properties_db_client)  
- Authentication: JWT tokens
- Document Storage: For metadata system properties
