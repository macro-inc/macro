const concurrently = require('concurrently');

if (process.platform === 'win32') {
  console.log('Must be run in Git bash');
}

console.log('Cleaning environment...');

const { result } = concurrently([
  {
    command: 'find . -type d -name node_modules -exec rm -rf {} +',
    name: 'Node Modules',
  },
  {
    command: 'find . -type d -name build -exec rm -rf {} +',
    name: 'Build',
  },
  {
    command: 'find . -type d -name dist -exec rm -rf {} +',
    name: 'Dist',
  },
  {
    command: 'find . -type d -name cache -exec rm -rf {} +',
    name: 'Cache',
  },
  {
    command: 'find . -type f -name tsconfig.tsbuildinfo -exec rm {} +',
    name: 'tsconfig.tsbuildinfo',
  },
]);

result.then(
  () => console.log('done'),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
