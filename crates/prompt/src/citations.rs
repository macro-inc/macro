//! Rules for citing source material inline.

use crate::types::StaticPrompt;

static TITLE: &str = "Citation Rules";

static INSTRUCTIONS: &str = r##"There are two systems: `[[...]]` for inline citations pointing to a specific part of a PDF or markdown node, and `<m-document-mention>` XML tags for linking to whole entities (documents, channels, chats, projects, tasks, email threads). Never mix them.

General citation rules:

- You must include citations from the provided source text when answering.
- Never fabricate citations.
- You may cite links by using a standard markdown link: [text](url)
- To cite documents use the following citation formats. If no id's are present in your converstation chain do not
  cite documents.

Citing Pdfs:
You can cite a specific part of a pdf by using the ID's that are included in the PDF context.They
appear in the pdf context as 36-character UUIDs enclosed in double quare brackets `[[uuid]]`

- Include a citation at most once in your final response.
- Example:
  - Source: “… establish Justice[[f52821e6-1f90-4a25-96a1-271022148151]].”
  - Response: “The document establishes justice[[f52821e6-1f90-4a25-96a1-271022148151]].”

Citing parts of markdown content:
You can cite specific parts of markdown documents by:

- Citations come from `$` metadata blocks inside the stringified JSON `content`.
- Recursively traverse all children and collect `"$.id"` values (8-character node ids).
- Format: `[[md;{document_id};{node_id}]]`
- Example:
  - Source node: `"$": { "id": "t3jn_Qq3" }`
  - Response: “Photosynthesis converts light to energy[[md;6a2b138d-dfbe-439a-a78b-282471a1e165;t3jn_Qq3]].”

### Example Responses

**PDF Example**
Source:
“…establish Justice[[f52821e6-1f90-4a25-96a1-271022148151]]…”
Response:
“The constitution establishes justice[[f52821e6-1f90-4a25-96a1-271022148151]].”

**Markdown Example**
Source node: `"$": { "id": "t3jn_Qq3" }` in document `6a2b138d-dfbe-439a-a78b-282471a1e165`
Response:
“Photosynthesis converts light to energy[[md;6a2b138d-dfbe-439a-a78b-282471a1e165;t3jn_Qq3]].”
"##;

static INTENT: &str = "Responses cite the provided source text using the correct inline \
citation format for PDFs and markdown nodes, never fabricating citations or mixing inline \
citations with mention tags.";

/// The citation-rules prompt.
pub static PROMPT: StaticPrompt<'static> = StaticPrompt::borrowed(TITLE, INSTRUCTIONS, INTENT);
