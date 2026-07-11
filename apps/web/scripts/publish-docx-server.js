const path = require('path');
const concurrently = require('concurrently');

if (!!process.env['CI']) {
  console.log('CI flag enabled assuming docx server is created');
  process.exit(0);
}

if (!!process.env['IGNORE_DOCX_SERVER']) {
  console.log(
    'IGNORE_DOCX_SERVER flag enabled therefore no need to build docx server'
  );
  process.exit(0);
}

function getDocxServerBuild() {
  if (process.platform === 'win32') return 'win-x64';
  if (process.platform === 'darwin')
    return process.arch === 'arm64' ? 'osx-arm64' : 'osx-x64';
  if (process.platform === 'linux') return 'linux-x64';
  console.log('Could not detect docx platform');
  return null;
}

const serverDir = path.resolve(__dirname, '../docx-server/Server');

const buildServer = process.env['DOCX_SERVER_BUILD'] ?? getDocxServerBuild();

if (!buildServer) {
  throw new Error(
    `DOCX_SERVER_BUILD env var not set, set either win-x64, osx-arm64 or osx-x64`
  );
}

concurrently([
  {
    command: `dotnet publish -c Release -r ${buildServer} --self-contained true -o ../dist/docx-server-${buildServer.replace(
      'osx',
      'mac'
    )}`,
    name: 'DocX',
    cwd: serverDir,
  },
]).then(
  () => console.log('done'),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
