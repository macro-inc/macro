# Extraction prompts

All editable classification and extraction instructions live in this folder.
Keep classification questions within Jev's 500-character limit; the intent
prompt contract test enforces it.
Describe intent boundaries in classification questions without copying behavior
baseline inputs into those questions; use independently authored phrases to
validate the rules rather than teaching the classifier each expected answer.

| Files | Used for |
| --- | --- |
| `classify_<intent>_prompt.txt` | Independent intent questions; opening action words strongly signal the requested destination. |
| `extract_search_unfiltered_query_prompt.txt` | Query-only search types retain unsupported filter clauses verbatim. |
| `extract_fields_prompt.txt` | Shared instructions for generative content extraction. |
| `extract_<intent>_prompt.txt` | Intent-specific generative instructions. Search adds selected-field guidance and the applicable query prompt. |
| `typed_<intent>_<field>_prompt.txt` | Individual Clairic field instructions. Search uses the same per-type query prompts as generative extraction. |
| `typed_search_scope_prompt.txt` | First-stage search type selection only. |
| `search_<type>_<field>_prompt.txt` | Type-specific search filter guidance; field names and schemas derive from the selected Rust response model. |
| `temporal_prompt.txt` | Temporal facts, source-span rules, and structured examples. |
| `temporal_task_prompt.txt` | Task-specific deadline instructions appended to the temporal prompt. |
| `temporal_output_prompt.txt` | Output instruction preceding the generated temporal schema. |

Rust assembles these instructions with generated schemas and task-property data.
Prompt files are embedded at compile time; rebuild the harness after editing
them. See the [behavior baseline](../eval/README.md) to compare live predictions.

Search type is selected first (or supplied by a manual Type choice), then only
that type's response schema is extracted. Add new search fields to the typed Rust
response model and supply field guidance here; the guidance coverage test fails
when a model field has no prompt. Task search status/priority choices come from
the frontend search picker catalog in `property_definitions`, not a prompt list.
