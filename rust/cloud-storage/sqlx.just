[no-cd]
create_db $DATABASE_URL:
    sqlx database create

[no-cd]
check_db $DATABASE_URL:
    sqlx migrate info

[no-cd]
migrate_db $DATABASE_URL:
    sqlx migrate run

[no-cd]
prepare_db $DATABASE_URL *FLAGS:
    cargo sqlx prepare --workspace -- {{ FLAGS }} --all-features --tests

[no-cd]
drop_db $DATABASE_URL *FLAGS:
    sqlx database drop {{ FLAGS }}

[no-cd]
setup $DATABASE_URL:
    sqlx database setup

[no-cd]
setup_prepare DATABASE_URL: (setup DATABASE_URL) (prepare_db DATABASE_URL)

[no-cd]
reset_db DATABASE_URL: (drop_db DATABASE_URL) (setup DATABASE_URL)
