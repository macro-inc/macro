# Document Processing Job Types

Contains all job types with their input validation for requests and responses.

## Publish

To publish you will need to create a .npmrc in this directory following this format:
```
//npm.pkg.github.com/:_authToken=${GITHUB_NPM_REGISTRY_AUTH_TOKEN}
@macro-inc:registry=https://npm.pkg.github.com/
```
This should already be provided for you in the existing .npmrc file.

The auth token is a personal access token tied to your account that has `write:packages`
and `read:packages` permissions.

Install deps - `pnpm i`
Build - `pnpm build`
Publish dev - `pnpm publish:dev`, this will set the dev tag so you can test it out, ideally use a -dev suffix for the version number
You would run something like `bun install @macro-inc/document-processing-job-types@dev` to get the latest dev version
Publish latest - `pnpm publish:latest`, this will set the latest tag
