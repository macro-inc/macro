# Image generation

`image_generation_toolset()` exposes `GenerateImage` to the shared AI toolset.
The tool mints an edit receipt for an optional destination project and invokes
`ImageGenerationService` with the requesting user and delegated bot identity.

The domain service validates the prompt, resolves up to three ordered reference
images through `ImageReferenceReader`, asks `ImageGenerator` for image bytes,
chooses the filename, and saves through `ImageDocumentStore`. Gemini implements
the provider port and receives references as inline image bytes.
`DocumentsImageStore` implements the save port by calling the `documents`
domain's `DocumentUploadService` inbound port.

`AttachmentImageReferenceReader` uses the document and static-file domains'
existing inbound `AttachmentService` implementations. Document references require
view access for the acting user. Static-file IDs retain their existing bearer
capability semantics and resolve only through configured storage; arbitrary URLs
are not accepted. Cross-domain adapters depend only on inbound ports.

Document creation, destination authorization, filename and size validation,
byte uploads, and failure cleanup remain in the existing document upload
lifecycle. The storage adapter uses no document repositories or outbound
adapters. Hosts compose the provider, reference reader, and storage services in
`ai_tools`.
