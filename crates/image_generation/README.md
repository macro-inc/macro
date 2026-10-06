# Image generation

`image_generation_toolset()` exposes `GenerateImage` to the shared AI toolset.
The tool invokes `ImageGenerationService` with the requesting user and delegated
bot identity.

The domain service validates the prompt, resolves up to three ordered reference
images through `ImageReferenceReader`, asks `ImageGenerator` for image bytes,
and saves through `ImageStore`. Gemini implements the provider port and receives
references as inline image bytes. `StaticFileImageStore` uploads through the
existing static file service client and returns the static file ID and permanent
URL only after the byte upload succeeds. The tool creates no DSS document and
accepts no filename or destination project.

`AttachmentImageReferenceReader` uses the document and static-file domains'
existing inbound `AttachmentService` implementations. Document references require
view access for the acting user. Static-file IDs retain their existing bearer
capability semantics and resolve only through configured storage; arbitrary URLs
are not accepted. Generated static file IDs can be reused for subsequent edits.

Hosts compose the provider, reference reader, and storage client in `ai_tools`.
The frontend renders the returned SFS image directly.

Usage is attributed by the domain service to the creating user (including bots
acting for users), or the system identity for team bots with no acting user.
Every host injects its usage recorder. Gemini records `usageMetadata` under
`image_generation` and the requested model before decoding or saving the image,
so provider-reported costs survive refusals, invalid image data, and upload
failures. Responses without usage metadata emit a warning and no estimated usage.
Pricing for the IMAGE-only Nano Banana requests is seeded in `ai_pricing`.
