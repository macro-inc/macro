# Macro Web App

This is Pulumi IaC for Macro Web App, deploying to AWS S3 and CloudFront Distribution with Route53 and ACM

## Dev Environment
1. Run `yarn build:web` in the root of the `app-monorepo`.
2. Run the command `$ yarn run deploy:dev` from this directory or `$ yarn workspace @macro-inc/infra-web-app run deploy:dev` from root directory will deploy `packages/app/dist` to https://app-dev.macro.com
