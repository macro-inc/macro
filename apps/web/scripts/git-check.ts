import { $ } from 'bun';

const MIN_GIT_VERSION = '2.40.0';
const MIN_GIT_LFS_VERSION = '3.5.0';

function parseVersion(output: string, regex: RegExp): string {
  const match = output.match(regex);
  if (!match) {
    throw new Error(`Unable to parse version from: ${output}`);
  }
  return match[1];
}

function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const part1 = parts1[i] || 0;
    const part2 = parts2[i] || 0;
    if (part1 > part2) return 1;
    if (part1 < part2) return -1;
  }
  return 0;
}

async function checkGitVersion(): Promise<number> {
  try {
    const gitOutput = await $`git --version`.text();
    const gitVersion = parseVersion(gitOutput, /(\d+\.\d+(\.\d+)?)/);

    if (compareVersions(gitVersion, MIN_GIT_VERSION) < 0) {
      console.error(
        `Git version ${gitVersion} is lower than the required version ${MIN_GIT_VERSION}.`
      );
      console.log('To update Git using Homebrew, run the following commands:');
      console.log('brew update');
      console.log('brew upgrade git');
      return 1;
    }

    console.log(`Git version ${gitVersion} is compatible.`);
    return 0;
  } catch (error) {
    console.error('Error checking Git version:', error);
    console.log('To install Git using Homebrew, run the following commands:');
    console.log('brew update');
    console.log('brew install git');
    return 1;
  }
}

async function checkGitLFSVersion(): Promise<number> {
  try {
    const lfsOutput = await $`git lfs version`.text();
    const lfsVersion = parseVersion(lfsOutput, /git-lfs\/(\d+\.\d+\.\d+)/);

    if (compareVersions(lfsVersion, MIN_GIT_LFS_VERSION) < 0) {
      console.error(
        `Git LFS version ${lfsVersion} is lower than the required version ${MIN_GIT_LFS_VERSION}.`
      );
      console.log(
        'To update Git LFS using Homebrew, run the following commands:'
      );
      console.log('brew update');
      console.log('brew upgrade git-lfs');
      return 1;
    }

    console.log(`Git LFS version ${lfsVersion} is compatible.`);
    return 0;
  } catch (error) {
    console.error('Error checking Git LFS version:', error);
    console.log(
      'To install Git LFS using Homebrew, run the following commands:'
    );
    console.log('brew update');
    console.log('brew install git-lfs');
    return 1;
  }
}

async function main() {
  const gitStatus = await checkGitVersion();
  const lfsStatus = await checkGitLFSVersion();

  if (gitStatus !== 0 || lfsStatus !== 0) {
    console.log(
      '\nPlease update the required components and run this script again.'
    );
    return 1;
  }

  console.log('\nAll required components are up to date!');
  return 0;
}

main().then(process.exit);
