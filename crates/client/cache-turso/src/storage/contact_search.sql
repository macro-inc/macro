SELECT r.__typename, r.id, r.value, s.rowid, s.profile
FROM search_rows AS s INDEXED BY search_rows_browse_idx
JOIN records AS r INDEXED BY records_contacts_cover_idx ON r.__typename = s.__typename AND r.id = s.id
WHERE s.slot = ?1 AND s.__typename = 'GraphqlContact'
  AND r.__typename = 'GraphqlContact'
