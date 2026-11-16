SELECT r.__typename, r.id, r.value
FROM search_documents AS s INDEXED BY search_documents_browse_idx
JOIN records AS r INDEXED BY records_contacts_cover_idx ON r.__typename = s.__typename AND r.id = s.id
WHERE s.profile = ?1 AND s.bucket = ?2 AND s.__typename = 'GraphqlContact'
  AND r.__typename = 'GraphqlContact'
