# Custom URL Parsers

This document describes the custom URL parsing functionality added to the unfurl service to handle special cases where document titles are embedded in the URL structure rather than available in HTML metadata.

## Supported Services

### Notion
- **Pattern**: `notion.so/[workspace]/[title-with-dashes]-[uuid]` or `notion.so/[title-with-dashes]-[uuid]`
- **Examples**:
  - `https://www.notion.so/macrocom/Enterprise-Product-Bottlenecks-5acb869109a747c1a1a92bbf1891ff2d` → "Enterprise Product Bottlenecks"
  - `https://www.notion.so/Macro-Work-Thoughts-e52b32630b2e45fab665b3e5c566cf3b` → "Macro Work Thoughts"
  - `https://www.notion.so/craft-ventures/Craft-Ventures-Operating-Playbooks-9db7bdccfc0f47be96076c122513691c` → "Craft Ventures Operating Playbooks"
- **Fallback**: Returns "Notion" if URL parsing fails

### Figma
- **Pattern**: `figma.com/design/[file-id]/[title-with-dashes]?...`
- **Examples**:
  - `https://www.figma.com/design/Kf1Vep5riU3re2GO4E0q6b/Peter-Copy-of-Paper-Crowns?node-id=0-1&p=f&t=Z2dZh8AyxauKitCl-0` → "Peter Copy Of Paper Crowns"
  - `https://www.figma.com/design/VWgAP7zMauuWKkeS3CmWk3/AI-side-panel?node-id=0-1&p=f&t=SqdP6D2w2rZ5iSjV-0` → "AI Side Panel"
- **Fallback**: Returns "Figma" if URL parsing fails

### Linear
- **Pattern**: `linear.app/[team]/issue/[ticket-id]/[title-with-dashes]`
- **Examples**:
  - `https://linear.app/macro-eng/issue/M-3586/ability-to-archive-emails` → "Ability To Archive Emails"
  - `https://linear.app/macro-eng/issue/M-3421/add-macro-permissions-to-jwt-token` → "Add Macro Permissions To Jwt Token"
- **Fallback**: Returns "Linear" if URL parsing fails

## Implementation Details

### Files Added/Modified

1. **`src/unfurl/url_parsers.rs`** (new): Contains the custom parsing logic for each service
2. **`src/unfurl/mod.rs`**: Updated to include the new url_parsers module
3. **`src/unfurl/unfurl.rs`**: Modified `GetUnfurlResponse::get_title()` to try custom parsing first before falling back to metadata
4. **`src/bin/test_parsers.rs`** (new): Standalone test binary to validate parser functionality
5. **`data/lots_of_links.json`**: Added test URLs for the new services

### How It Works

1. When `GetUnfurlResponse::get_title()` is called, it first attempts custom URL parsing using `parse_custom_title()`
2. If custom parsing succeeds, it returns the parsed title
3. If custom parsing fails or returns `None`, it falls back to the original metadata extraction logic
4. For supported services that can't be parsed (e.g., homepage URLs), it returns the service name as fallback

### Function Hierarchy

```
GetUnfurlResponse::get_title()
├── parse_custom_title()
│   ├── parse_notion_title() → Some("Parsed Title") | None
│   ├── parse_figma_title() → Some("Parsed Title") | None  
│   ├── parse_linear_title() → Some("Parsed Title") | None
│   └── Fallback to service name (e.g., "Notion", "Figma", "Linear")
└── Original metadata extraction (if custom parsing returns None)
```

## Testing

### Running Tests

Due to workspace Cargo issues with `edition2024`, the tests may not run directly. However, the functionality can be tested manually:

1. **Unit Tests**: Added comprehensive tests in `src/unfurl/unfurl.rs` for all three services
2. **Integration Tests**: Added tests that verify the integration with `GetUnfurlResponse::get_title()`
3. **Standalone Test Binary**: `src/bin/test_parsers.rs` provides a way to test parsers independently

### Manual Testing

You can test the service manually by starting it and making requests:

```bash
# Start the service
just run

# Test Notion URL
curl 'http://localhost:8080/unfurl?url=https://www.notion.so/macrocom/Enterprise-Product-Bottlenecks-5acb869109a747c1a1a92bbf1891ff2d'

# Test Figma URL  
curl 'http://localhost:8080/unfurl?url=https://www.figma.com/design/Kf1Vep5riU3re2GO4E0q6b/Peter-Copy-of-Paper-Crowns?node-id=0-1&p=f&t=Z2dZh8AyxauKitCl-0'

# Test Linear URL
curl 'http://localhost:8080/unfurl?url=https://linear.app/macro-eng/issue/M-3586/ability-to-archive-emails'

# Test bulk processing
just bulk-link-test
```

## Future Considerations

- **URL Format Changes**: These companies may change their URL formats in the future. The parsers are designed to be simple and focused on current patterns.
- **Additional Services**: The architecture supports adding more custom parsers by extending the `parse_custom_title()` function.
- **Performance**: Custom parsing happens before web requests, so it's faster for supported URLs.
- **Fallback Strategy**: All parsers include graceful fallbacks to ensure the service remains functional even if parsing logic breaks.

## Error Handling

- Invalid URLs return `None` and fall back to metadata extraction
- Malformed URLs for supported services return the service name as fallback
- Non-supported URLs are ignored and processed normally
- All parsing is done safely with proper error handling 