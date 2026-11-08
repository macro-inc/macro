# lexical_mention_extractor

## What it is

The Messages outbound adapter for mentions embedded in message Markdown.

## Start here

- `src/lib.rs`: implements `messages::MessageMentionExtractor` through the
  host-configured Lexical facade and maps its typed mentions.

## Boundaries

- Hosts inject the configured `Arc<LexicalClient>`; do not load route config per
  message or construct a separate HTTP client here.
- Parsing belongs to `macro_document_model`; mention storage and access checks
  belong to `messages`.

## Checks

- `cargo test -p lexical_mention_extractor`.
- The hand-written boundary test exercises all three modes and checks that
  in-process extraction never calls lexical-service.
