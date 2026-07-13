# Guide to Writing AI Tools

This guide covers best practices for designing tools that AI agents can use effectively. Tools are a contract between deterministic systems and non-deterministic agents—they require fundamentally different design thinking than traditional APIs.

## Core Philosophy

Tools should be designed around how agents think, not how your backend is organized. An agent doesn't care about your microservice boundaries or database schema. It cares about accomplishing tasks with minimal friction and context waste.

**The goal**: Enable an agent to accomplish tasks as efficiently as a knowledgeable human team member would.

## Tool Design Principles

### 1. Tools Are Not Endpoints

Do not create a 1:1 mapping between API endpoints and tools. This is the most common mistake.

Instead, design tools around **workflows and intentions**. A single tool might orchestrate multiple backend calls, or conversely, a single complex endpoint might become several focused tools.

**Think workflow, not API**: If a human would naturally perform several operations together to accomplish a goal, that's probably one tool. If a single endpoint serves multiple distinct purposes, that's probably multiple tools.

### 2. Curate, Don't Expose

Tools should expose a **curated selection** of capabilities, not a comprehensive API surface. More tools don't guarantee better outcomes—they create confusion. Every tool you add competes for the agent's attention and increases the chance of suboptimal tool selection.

Ask yourself:
- Does this tool serve a clear, distinct purpose?
- Would an agent naturally reach for this when given a relevant task?
- Is this tool's purpose obviously different from existing tools?

### 3. Simplify Parameters

Complex endpoints with many options should become either:
- **Multiple simple tools** with focused purposes, OR
- **One tool with simplified, opinionated options**

Agents work best with clear, constrained choices. A tool with 15 optional parameters forces the agent to reason about combinations it may not understand. A tool with 2-3 well-chosen parameters guides the agent toward success.

**Prefer enums over strings**: When a parameter has known valid values, use an enum. This eliminates hallucination risk and makes the tool self-documenting.

### 4. Filters Over Pagination

List endpoints should **never expose pagination parameters** to AI. Pagination is an implementation detail that agents handle poorly—they don't know when to stop paging, waste context on partial results, and often miss relevant items.

Instead, provide **semantic filters** that let agents request exactly what they need:
- Filter by status, type, date range, ownership
- Support search/query parameters for text matching
- Return reasonably-sized result sets with sensible defaults

If results might be large, implement truncation with a summary (e.g., "showing 50 of 234 results matching your criteria").

### 5. Return What's Needed, Not Everything

Tool responses should contain **high-signal, contextually relevant information**. Returning comprehensive technical details wastes the agent's limited context window.

Consider implementing a `response_format` parameter with options like "concise" or "detailed" when tools might return varying levels of detail. The concise format for reasoning, the detailed format when the agent needs specific identifiers for downstream operations.

## Naming and Documentation

### Tool Names

Names should be:
- **Unambiguous**: The purpose should be clear from the name alone
- **Action-oriented**: Use verbs that describe the workflow (search_customers, schedule_meeting)
- **Namespaced when related**: Group related tools with prefixes (documents_search, documents_create)

### Descriptions

Tool descriptions are prompt engineering. Write them as you would explain the tool to a new team member:
- State the tool's purpose in one sentence
- Explain when to use it (and when not to)
- Make implicit context explicit (expected formats, terminology, relationships between concepts)
- Describe what the tool returns

### Parameter Descriptions

Every parameter needs a clear description. Avoid ambiguous names—use `user_id` not `user`, `project_name` not `project`.

For the ai_toolset crate, use schemars attributes:
- `#[schemars(title = "...", description = "...")]` on the input struct
- `#[schemars(description = "...")]` on each field

See `src/lib.rs` for documentation patterns and `src/schema/` for schema requirements.

### Error Messages

Return specific, actionable error messages. "User not found" is better than "404". "No documents match the filter 'status=archived'" is better than "Empty result".

Agents use error messages to self-correct. Help them understand what went wrong and what to try instead.

## Consolidation Patterns

Look for opportunities to combine related operations into workflow-oriented tools:

**Instead of**: list_users, list_events, check_availability, create_event
**Consider**: schedule_meeting (finds availability and creates the event)

**Instead of**: get_customer, list_transactions, list_notes
**Consider**: get_customer_context (compiles relevant recent information)

**Instead of**: read_file with line numbers
**Consider**: search_file_content (returns relevant sections with context)

The goal is reducing the number of tool calls needed for common tasks while keeping each tool's purpose clear.

## Testing Tools

Create evaluations using realistic, multi-step tasks. Analyze agent reasoning to identify:
- Tools the agent avoids or misuses
- Parameters that cause confusion
- Missing capabilities that force awkward workarounds
- Excessive tool calls that could be consolidated

Iterate on tool design based on how agents actually use them, not how you imagine they will.

## Summary Checklist

Before adding a tool, verify:

- [ ] The tool serves a clear, distinct workflow purpose
- [ ] It's not a 1:1 endpoint mapping
- [ ] Parameters are simple and well-constrained
- [ ] No pagination—uses filters instead
- [ ] Returns appropriately-sized, relevant responses
- [ ] Name clearly conveys purpose
- [ ] Description explains when and how to use it
- [ ] All parameters have clear descriptions
- [ ] Error messages are actionable

## Further Reading

- Anthropic's guide: https://www.anthropic.com/engineering/writing-tools-for-agents
- Crate documentation: `src/lib.rs`
- Schema requirements: `src/schema/`
