# PDF Preprocess Lambda

## Build

To buld the lambda image for testing run:

`docker build --platform linux/arm64 -t pdf-preprocess-lambda .`

To run the docker image locally you can do:

```
docker run --platform linux/arm64 --env-file .env -p 9000:8080 pdf-preprocess-lambda:latest
```

**note** you will need to create a .env file using the .env.sample provided in
this folder

## Testing Locally

Since you'll need database access you'll need to run `docker-compose -f docker-compose.dev.yml --env-file ./.env up macrodb pdf_preprocess_lambda`

To invoke the lambda run:
```
curl "http://localhost:9000/2015-03-31/functions/function/invocations" -d '{"bucket": "whutchinson-testing-bucket", "key": "9.pdf", "sha": "test-sha"}'
```
