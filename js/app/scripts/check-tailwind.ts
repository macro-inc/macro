#!/usr/bin/env bun
import { execSync } from 'child_process';
import { extname, relative } from 'path';

interface Violation {
  file: string;
  line: number;
  column: number;
  className: string;
  lineContent: string;
}

interface ChangedLine {
  file: string;
  lineNumber: number;
  content: string;
}

const PROHIBITED_TAILWIND_REGEX =
  /\b((bg|border|text|fill|caret|outline|shadow|ring|stroke)(-(white|black|(?:red|blue|green|yellow|purple|pink|indigo|gray|grey|orange|teal|cyan|emerald|lime|amber|violet|fuchsia|rose|sky|slate|zinc|neutral|stone)-\d{2,3}))|font-(berkeley|inter))\b/g;

const FILE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'];

function getChangedLines(baseBranch: string = 'origin/dev'): ChangedLine[] {
  try {
    // Get the diff with context to parse added/modified lines
    const output = execSync(`git diff --unified=0 ${baseBranch}...HEAD`, {
      encoding: 'utf8',
      stdio: 'pipe',
    });

    const changedLines: ChangedLine[] = [];
    const lines = output.split('\n');
    let currentFile = '';
    let currentLineNumber = 0;

    for (const line of lines) {
      // Parse file headers
      if (line.startsWith('diff --git')) {
        const match = line.match(/diff --git a\/(.*) b\/(.*)/);
        if (match) {
          const filePath = match[2];
          const ext = extname(filePath);
          if (
            FILE_EXTENSIONS.includes(ext) &&
            filePath.startsWith('packages/')
          ) {
            currentFile = filePath;
          } else {
            currentFile = '';
          }
        }
        continue;
      }

      // Skip if we're not in a relevant file
      if (!currentFile) continue;

      // Parse hunk headers to get line numbers
      if (line.startsWith('@@')) {
        const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (match) {
          currentLineNumber = parseInt(match[1], 10);
        }
        continue;
      }

      // Check added lines (lines starting with +, but not +++)
      if (line.startsWith('+') && !line.startsWith('+++')) {
        const content = line.slice(1); // Remove the + prefix
        changedLines.push({
          file: currentFile,
          lineNumber: currentLineNumber,
          content: content,
        });
        currentLineNumber++;
      } else if (line.startsWith(' ')) {
        // Context line, increment line number
        currentLineNumber++;
      }
      // Lines starting with - are deletions, don't increment currentLineNumber
    }

    return changedLines;
  } catch (error) {
    console.warn(`Warning: Could not get changed lines: ${error}`);
    return [];
  }
}

function checkChangedLines(changedLines: ChangedLine[]): Violation[] {
  const violations: Violation[] = [];

  for (const changedLine of changedLines) {
    const matches = [
      ...changedLine.content.matchAll(PROHIBITED_TAILWIND_REGEX),
    ];

    for (const match of matches) {
      if (match.index !== undefined) {
        violations.push({
          file: changedLine.file,
          line: changedLine.lineNumber,
          column: match.index + 1,
          className: match[0],
          lineContent: changedLine.content.trim(),
        });
      }
    }
  }

  return violations;
}

function formatViolations(
  violations: Violation[],
  workspaceRoot: string
): void {
  if (violations.length === 0) {
    console.log('✅ No prohibited Tailwind classes found in changed lines!');
    return;
  }

  console.log(
    `❌ Found ${violations.length} prohibited Tailwind class${violations.length === 1 ? '' : 'es'} in changed lines:\n`
  );

  const groupedByFile = violations.reduce(
    (acc, violation) => {
      if (!acc[violation.file]) {
        acc[violation.file] = [];
      }
      acc[violation.file].push(violation);
      return acc;
    },
    {} as Record<string, Violation[]>
  );

  for (const [file, fileViolations] of Object.entries(groupedByFile)) {
    const relativePath = relative(workspaceRoot, file);
    console.log(`📄 ${relativePath}`);

    for (const violation of fileViolations) {
      console.log(
        `   ${violation.line}:${violation.column} - "${violation.className}"`
      );
      console.log(`   ${violation.lineContent}`);
      console.log('');
    }
  }

  console.log('💡 Tip: Replace these with semantic classes.');
  console.log('   Example: bg-red-500 → bg-failure, bg-white → bg-dialog, font-berkely → font-mono, etc');
}

async function main(): Promise<void> {
  const workspaceRoot = process.cwd();

  console.log(
    '🔍 Checking for prohibited Tailwind classes in changed lines...\n'
  );

  try {
    // Get the base branch from environment variable (for CI) or default to origin/dev
    const baseBranch = process.env.GITHUB_BASE_REF
      ? `origin/${process.env.GITHUB_BASE_REF}`
      : 'origin/dev';
    const changedLines = getChangedLines(baseBranch);

    if (changedLines.length === 0) {
      console.log('✅ No relevant lines changed!');
      return;
    }

    const fileCount = new Set(changedLines.map((line) => line.file)).size;
    console.log(
      `📁 Scanning ${changedLines.length} changed line${changedLines.length === 1 ? '' : 's'} across ${fileCount} file${fileCount === 1 ? '' : 's'}...`
    );

    const violations = checkChangedLines(changedLines);

    console.log('');
    formatViolations(violations, workspaceRoot);

    if (violations.length > 0) {
      process.exit(1);
    }
  } catch (error) {
    console.error(`Error: ${error}`);
    process.exit(1);
  }
}

// Run the main function
main();
