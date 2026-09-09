# Investigation Report: AI Can't Read Email Attachments

## Root Cause

The MCP server instructions were telling AI agents to use `ReadThread` for all threaded content, but `ReadThread` doesn't support email threads. It only supports:
- Channel
- ChannelMessage
- ChatThread
- ChatMessage
- Project

Email threads require a different tool: `GetThread`.

## The Problem

In `/workspace/services/mcp_service/src/tool_service.rs`, the MCP server instructions said:

```rust
"Use ReadContent, ReadMetadata, and ReadThread to read them."
```

This mislead AI agents into trying to use `ReadThread` for email threads, which would fail because email is not a supported `ContentType` in the `ReadThread` schema.

## The Solution

I updated the MCP server instructions to be more specific:

```rust
"Use ContentSearch and NameSearch to find entities. \
 Use ReadContent and ReadMetadata to read documents. \
 Use ReadThread to read channels, chats, and projects. \
 Use GetThread to read email threads. \
 Use CreateDocument to create new documents. \
 Use EditDocument to edit existing documents. \
 Use ListEntities to browse recent items."
```

## Technical Details

### ReadThread Tool
- **Location**: `/workspace/crates/ai_tools/src/schemas/read.rs`
- **Type**: PhantomTool (schema-only, no Rust implementation)
- **Supported Types**: Channel, ChannelMessage, ChatThread, ChatMessage, Project
- **Missing**: EmailThread/Email support

### GetThread Tool
- **Location**: `/workspace/crates/email/src/inbound/toolset/get_thread.rs`
- **Type**: Fully implemented AsyncTool
- **Purpose**: "Retrieve an email thread and its messages"
- **Included in**: `email_mcp_toolset()` which is used by `AiHost::Mcp`
- **Returns**: Thread metadata, labels, messages with sender/recipients/body

## Files Changed

1. `/workspace/services/mcp_service/src/tool_service.rs` - Updated MCP server instructions
2. `/workspace/services/mcp_service/src/tool_service/test.rs` - Updated test to include GetThread

## Verification

The `GetThread` tool was already properly wired into the MCP toolset via:
```rust
// In /workspace/crates/ai_tools/src/lib.rs line 153
AiHost::Mcp => toolset
    .add_subtoolset::<ToolEmailToolContext>(email_mcp_toolset())
```

And the `email_mcp_toolset()` includes:
```rust
// In /workspace/crates/email/src/inbound/toolset.rs line 234
.add_tool::<GetThread, EmailToolContext<T, G, E>>()
```

## Conclusion

The issue wasn't that the tool was missing - it was that the AI was being directed to use the wrong tool. With the updated instructions, AI agents will now know to use `GetThread` specifically for email threads, which should resolve the "AI can't read email attachments" issue.
