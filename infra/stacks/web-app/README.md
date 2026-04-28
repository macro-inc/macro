# Macro Web App

This is Pulumi IaC for Macro Web App, deploying to AWS S3 and CloudFront Distribution with Route53 and ACM

## Dev Environment
1. Run `just build-dev` from `js/app/`.
2. Run `$ yarn run deploy:dev` from this directory or `$ yarn workspace @macro-inc/infra-web-app run deploy:dev` from root directory to deploy the build artifact from `js/app/packages/app/dist` to https://app-dev.macro.com
