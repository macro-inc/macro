psql postgres://seq_test@127.0.0.1:22950/macrodb -Atc "select to_regclass('_sqlx_test.databases')" 
export DATABASE_URL=postgres://seq_test@127.0.0.1:22950/macrodb; unset SQLX_OFFLINE
cargo test -j 16 -p messages -p graphql_channel --all-features 2>&1 | grep -E "^test result|FAILED|panicked" | head -12
