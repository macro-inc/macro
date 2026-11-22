SELECT r.__typename, r.id, r.value
FROM search_rows AS s
JOIN records AS r INDEXED BY records_contacts_cover_idx ON r.__typename = s.__typename AND r.id = s.id
WHERE s.rowid BETWEEN ?1 AND ?2 AND s.__typename = 'GraphqlContact'
  AND r.__typename = 'GraphqlContact'
