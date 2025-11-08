# Prepare DB for offline cache
prepare_db:
	DATABASE_URL=postgres://user:password@localhost:5432/macrodb cargo sqlx prepare
build:
	cargo lambda build --release --output-format zip
