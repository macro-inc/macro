prepare_db:
	DATABASE_URL=postgres://user:password@localhost:5432/macrodb cargo sqlx prepare
build:
	SQLX_OFFLINE=true cargo lambda build --release --output-format zip
