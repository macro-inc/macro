# image_generation

## What it is

Belongs to AI tools: generates images from a prompt (with up to three
reference images), stores them as static files, and exposes the flow through
an AI toolset (`GenerateImage`).

## Start here

- `README.md`: the request flow (reference resolution → provider → store) and
  usage-attribution rules — read this first, it's accurate and current.
- `src/domain/service.rs`: `ImageGenerationService` — validates the prompt,
  resolves up to three reference images, calls the provider, saves the result.
- `src/domain/ports.rs`: `ImageGenerator`, `ImageReferenceReader`, `ImageStore`
  — the three seams a host composes.
- `src/outbound/gemini.rs`: the Gemini provider adapter (records
  `usageMetadata` before decode/save so cost survives failures).
- `src/outbound/static_files.rs`: `StaticFileImageStore`.
- `src/inbound/toolset/generate_image.rs`: the AI toolset entry point.

## Scope

- Owns: image generation orchestration, reference resolution, and the toolset
  wrapper.
- Not here: provider composition (which `ImageGenerator`/`ImageReferenceReader`
  to use) — that's `ai_tools`, the host crate.

## Boundaries

- Depends on: `ai_toolset`, `ai_usage`, `attachment`, `lexical_client`,
  `static_file_service_client`.
- Used by: `ai_tools` (composes providers and wires the toolset).

## Recipes

- Add a reference source: implement `ImageReferenceReader` →
  `src/outbound/references.rs` → wire it in the composing host (`ai_tools`).
- Add a new provider: implement `ImageGenerator` → `src/outbound/<provider>.rs`
  → wire it in `ai_tools`.

## Checks

- `cargo test -p image_generation`.

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/code.md`
  (GenAI telemetry/usage rules)
