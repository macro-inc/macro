// scripts/optimize-dependencies.js
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Glob } from 'bun';

async function optimizeDependencies() {
  console.log('🔍 Scanning for duplicate Monaco VS Code packages...');

  // Find all Monaco packages
  const rootNodeModules = resolve(__dirname, '../../../node_modules');

  // Use Bun's Glob API correctly
  const glob = new Glob('**/@codingame/monaco-vscode-*-common/package.json');

  // Group by package name
  const packageGroups = {};

  for await (const globPath of glob.scan(rootNodeModules)) {
    try {
      const pkgJsonPath = resolve(rootNodeModules, globPath);
      const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
      const packagePath = dirname(pkgJsonPath);
      const packageName = pkgJson.name;
      const version = pkgJson.version;

      packageGroups[packageName] = packageGroups[packageName] || [];
      packageGroups[packageName].push({
        path: packagePath,
        version,
        depth: packagePath.split('node_modules').length - 1, // Calculate nesting depth
      });
    } catch (e) {
      console.error(`Error reading ${globPath}:`, e.message);
    }
  }

  // Find duplicates
  let totalDuplicates = 0;
  let packagesWithDuplicates = 0;
  const resolutions = {};

  for (const [packageName, instances] of Object.entries(packageGroups)) {
    if (instances.length > 1) {
      packagesWithDuplicates++;
      totalDuplicates += instances.length - 1;

      // Sort by depth (prefer shallower/top-level packages)
      instances.sort((a, b) => a.depth - b.depth);

      console.log(`Found ${instances.length} copies of ${packageName}:`);

      for (let i = 0; i < instances.length; i++) {
        const instance = instances[i];
        const keepThisOne = i === 0 ? ' (keeping)' : ' (duplicate)';
        console.log(
          `  - ${instance.path} (depth: ${instance.depth})${keepThisOne}`
        );

        // Add to resolutions
        if (i === 0) {
          resolutions[packageName] = instance.version;
        } else {
          // Remove duplicates at deeper levels
          console.log(`    Removing duplicate: ${instance.path}`);
          await Bun.$`rm -rf ${instance.path}`;
        }
      }
    }
  }

  // Update package.json with resolutions
  if (Object.keys(resolutions).length > 0) {
    const packageJsonPath = resolve('package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    packageJson.dependencies = {
      ...(packageJson.dependencies || {}),
      ...resolutions,
    };

    // Ensure the bun section exists
    packageJson.bun ??= {};
    packageJson.bun.resolutions = {
      ...(packageJson.bun.resolutions || {}),
      ...resolutions,
    };

    // Save updated package.json
    writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
    console.log('✅ Updated package.json with resolutions');
  }

  console.log(`\n📊 Summary:`);
  console.log(
    `Found ${Object.keys(packageGroups).length} unique Monaco VS Code packages`
  );
  console.log(`Found ${packagesWithDuplicates} packages with duplicates`);
  console.log(`Removed ${totalDuplicates} duplicate package instances`);

  // Reinstall dependencies with Bun
  if (totalDuplicates > 0) {
    console.log('\n🔄 Reinstalling dependencies with Bun...');
    try {
      // Force reinstall to apply resolutions
      await Bun.$`bun install --force`;
      console.log('✅ Dependencies reinstalled successfully');
    } catch (e) {
      console.error('❌ Error reinstalling dependencies:', e);
    }
  } else {
    console.log('✅ No duplicates found, skipping reinstall');
  }
}

// Execute the function
optimizeDependencies().catch((err) => {
  console.error('Failed to optimize dependencies:', err);
  process.exit(1);
});
