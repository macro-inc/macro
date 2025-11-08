Provides shared resources to be used for pulumi stacks in macro-api.
In order to link this project to your stack, you will need to first build the 
package with `npm run build`. Then run `npm link` in this folder. Finally go to the
pulumi infra folder you want to `pulumi up` in and run `npm link pulumi-shared-resources`. This will create a symlink in that pulumi project's `node_modules` folder to this folder.

Actually, instead of doing the above you can just link as a dependency. In the `package.json` you can add something like:
```
"dependencies": {
    "pulumi-shared-resources": "file:../../pulumi-shared-resources"
  }
```