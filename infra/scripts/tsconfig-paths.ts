// this is needed until https://github.com/pulumi/pulumi/issues/3061 is resolved
const { loadConfig, register } = require('tsconfig-paths');
const minimist = require('minimist');

const isPulumiCommand = process.argv[1]?.includes('pulumi') ?? false;
if (isPulumiCommand) {
  const argv = minimist(process.argv.slice(2), { string: ['pwd'] });
  const tsConfig = loadConfig(argv.pwd);

  if (tsConfig.resultType === 'success') {
    register({
      baseUrl: tsConfig.absoluteBaseUrl,
      paths: tsConfig.paths,
    });
  }
}
export default {};
