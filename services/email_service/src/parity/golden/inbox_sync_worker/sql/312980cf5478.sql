SELECT oid, typarray FROM pg_catalog.pg_type WHERE oid = $1::regtype::oid
