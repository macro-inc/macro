---
name: swagger
description: Launch local Swagger UI for a service's OpenAPI spec
allowed-tools: Bash, Read, Write
---

# Swagger UI Launcher

Launch a local Swagger UI to explore a service's OpenAPI specification.

## Usage

```
/swagger <service-name>
```

## Available Services

The OpenAPI specs are located at `js/app/packages/service-clients/service-<name>/openapi.json`:

- `auth` - Authentication service
- `cognition` - Cognition service
- `comms` - Communications service
- `connection` - Connection service
- `contacts` - Contacts service
- `email` - Email service
- `notification` - Notification service
- `properties` - Properties service
- `search` - Search service
- `static-files` - Static files service
- `storage` - Storage service
- `unfurl` - Unfurl service

## Instructions

1. Parse the service name from the argument: `$ARGUMENTS`
2. If no argument provided, list available services and ask user to specify one
3. Validate the service exists at `js/app/packages/service-clients/service-<name>/openapi.json`
4. Create a temporary directory and HTML file to serve Swagger UI with OpenAPI 3.1.0 support:

```bash
SPEC_PATH=$(realpath js/app/packages/service-clients/service-<name>/openapi.json)
TEMP_DIR=$(mktemp -d)
cp "$SPEC_PATH" "$TEMP_DIR/openapi.json"
```

5. Create index.html in the temp directory with this content:

```html
<!DOCTYPE html>
<html>
<head>
  <title>Swagger UI - service-<name></title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: '/openapi.json',
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: "BaseLayout"
    });
  </script>
</body>
</html>
```

6. Serve and open in browser:

```bash
cd "$TEMP_DIR" && bunx serve -p 8080 &
sleep 1 && open http://localhost:8080
```

## Output

Tell the user:
- Which service's API docs are being served
- The URL: http://localhost:8080
- How to stop the server (Ctrl+C or kill the serve process)
