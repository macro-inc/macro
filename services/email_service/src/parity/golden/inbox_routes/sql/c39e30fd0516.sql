SELECT id, draft_id, file_name, content_type, sha, size, s3_key, upload_pending, content_id, is_inline FROM email_attachments_drafts WHERE draft_id = ANY($1) ORDER BY draft_id, file_name ASC
