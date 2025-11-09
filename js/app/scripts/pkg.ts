import { dirname, join } from 'path';
import { $ } from 'bun';
import { writeFile } from 'fs/promises';

type PackageJson = {
  name: string;
  [key: string]: any;
};

async function copyFolder(src: string, dest: string): Promise<void> {
  await $`cp -R ${src}/ ${dest}/`;
}

async function modifyPackageJson(
  packagePath: string,
  newName: string
): Promise<void> {
  const packageJson: PackageJson = await Bun.file(packagePath, {
    type: 'application/json',
  }).json();
  packageJson.name = newName;
  await writeFile(packagePath, JSON.stringify(packageJson, null, 2));
}

function getPackageName(input: string): {
  fullName: string;
  folderName: string;
} {
  const name = input.startsWith('@macro-inc/') ? input : `@macro-inc/${input}`;
  const folderName = name.replace('@macro-inc/', '');
  return { fullName: folderName, folderName };
}

async function promptUser(question: string): Promise<string> {
  process.stdout.write(question);
  for await (const line of console) {
    return line.trim();
  }
  throw new Error('No input received');
}

async function main() {
  let inputName = Bun.argv[2];

  if (!inputName) {
    inputName = await promptUser('Enter the new package name: ');
  }

  const { fullName, folderName } = getPackageName(inputName);

  const templatePath = 'packages/template-package';
  const newPackagePath = `packages/${folderName}`;

  await copyFolder(templatePath, newPackagePath);
  await modifyPackageJson(
    join(dirname(import.meta.dir), newPackagePath, 'package.json'),
    fullName
  );

  console.log(`Package created: ${fullName}`);
}

main().catch(console.error);
