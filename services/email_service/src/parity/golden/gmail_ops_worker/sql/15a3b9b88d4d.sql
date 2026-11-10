SELECT oid::regtype::text, typtype, typcategory, typrelid, typelem, typbasetype FROM pg_catalog.pg_type WHERE oid = $1
