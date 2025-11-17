# Cloud Storage Cache

This stack creates an ECR repository for the Cloud Storage cache image.

Note: This stack does not build the cache image itself. It only creates the ECR repository.
The cache image is built by `.github/workflows/build-cloud-storage-cache.yml` on push to the `main` branch.
This is because awsx is slow at building images and it's faster to use docker/buildx github action to build the image.
