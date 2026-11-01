# image_optimizer

## What it is

Shared infrastructure for serving images (documents, email, attachments,
etc.). A Lambda behind CloudFront (triggered via Function URL) that
resizes/transcodes images on first request and caches the result in S3 at a
variant key.

## Start here

- `src/handler.rs`: `handle_async_resize` — fetch original from S3, transform,
  write the variant back to S3 with a long cache TTL so CloudFront/S3 serve it
  directly on subsequent requests (falls back to caching the original on a
  transform failure, to avoid retry storms).
- `src/request.rs`: parses the CloudFront-rewritten `rawPath` (e.g.
  `/file/{uuid}/format=avif,size=1080`) into `FilePath` / `AsyncResizeRequest`.
- `src/transform.rs`: `TransformParams` validation (`MAX_SIZE = 4096`, no
  upscaling) and the actual `image` crate resize/encode.

## Scope

- Owns: on-demand image resize/format conversion and its S3 variant cache.
- Not here: the CloudFront URL rewrite that produces the `format=...,size=...`
  suffix (infra-side), or general authenticated image fetching → `image_proxy_service`.

## Checks

- `cargo test -p image_optimizer` (`SQLX_OFFLINE` unset).
