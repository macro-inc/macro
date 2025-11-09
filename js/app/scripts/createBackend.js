const { execSync } = require('child_process');

const goToPdfServer = 'cd ./pdf-server/pdfreader';
const mvnCleanPackage = 'mvn clean package';

if (process.env['CI'] === 'true') {
  console.log('CI flag enabled assuming pdf server is created');
  process.exit(0);
}

console.log('Creating backend.jar');
execSync(`${goToPdfServer} && ${mvnCleanPackage}`, {
  stdio: 'inherit',
});
