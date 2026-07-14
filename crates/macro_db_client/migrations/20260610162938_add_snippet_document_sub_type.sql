-- Add 'snippet' to the document sub type enum.
-- Snippets are reusable markdown documents that can be inserted into any
-- markdown area (`;` menu in the editor).
ALTER TYPE document_sub_type_value ADD VALUE IF NOT EXISTS 'snippet';
