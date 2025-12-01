[no-cd]
create_db $DATABASE_URL:
    cargo sqlx database create

[no-cd]
migrate_db $DATABASE_URL:
    cargo sqlx migrate run

[no-cd]
prepare_db $DATABASE_URL *FLAGS:
    cargo sqlx prepare -- {{ FLAGS }}

[no-cd]
drop_db $DATABASE_URL *FLAGS:
    cargo sqlx database drop {{ FLAGS }}

[no-cd]
setup $DATABASE_URL:
    cargo sqlx database setup

[no-cd]
setup_prepare DATABASE_URL: (setup DATABASE_URL) (prepare_db DATABASE_URL)

[no-cd]
reset_db DATABASE_URL: (drop_db DATABASE_URL) (setup DATABASE_URL)
