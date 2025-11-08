# Document Text Extractor
This lambda is responsible for extracting text from documents and storing it in a database.

## Prerequisites

- Install and setup *Rust* ecosystem on your machine.
- [Cargo lambda](https://www.cargo-lambda.info/guide/installation.html)
- *sqlx-cli* installed with `cargo install sqlx-cli`.
- *just* installed with `cargo install just`

## Building for deployment

*DO NOT* try and build this lambda from this directory for deployment.

```bash
# root of the cloud-storage project
cd macro-api/cloud-storage

# run make command
make build_document_text_extractor
```

## Local Development
1. Start local macrodb postgres instance
```bash
# from the root of the project
docker-compose up macrodb -d  # use -d to run in background
./database/init.sh # initializes the database if needed
```

2. Create and fill in your `.env` file based on the `.env.sample`  
```bash
cp .env.sample .env
```

3. Start the lambda locally
```bash
#using just
just local


# cargo on linux
cargo lambda watch

# cargo on mac
cargo lambda watch --features macos
```

3. Invoke the lambda using the sample input
```bash
# using just
just invoke data_file="sample_input.json"

# using cargo
cargo lambda invoke document-text-extractor --data-file sample_input.json
```


## Testing

You must have the macrodb up and running locally to perform testing.

`just test` or `cargo test` to run tests
