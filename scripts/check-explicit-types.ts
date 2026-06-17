import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

type ScanState = 'code' | 'single' | 'double' | 'template' | 'line' | 'block';

interface Finding {
  file: string;
  line: number;
  column: number;
  snippet: string;
}

const scannedRoots = [
  'src',
  'scripts'
];
const ignoredDirectories = new Set([
  '.angular',
  '.local',
  'coverage',
  'dist',
  'extension',
  'legacy',
  'node_modules'
]);
const forbiddenToken = String.fromCharCode(97, 110, 121);
const forbiddenTokenPattern = new RegExp(`\\b${forbiddenToken}\\b`, 'g');
const findings: Finding[] = [];

for (const root of scannedRoots) {
  for (const file of await collectTypeScriptFiles(root)) {
    const source = await readFile(file, 'utf8');
    const codeOnlySource = stripNonCode(source);
    let match: RegExpExecArray | null;

    while ((match = forbiddenTokenPattern.exec(codeOnlySource)) !== null) {
      findings.push(describeFinding(file, source, match.index));
    }
  }
}

if (findings.length > 0) {
  console.error('Forbidden explicit top type found:');
  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line}:${finding.column} ${finding.snippet}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Strict type scan passed for ${scannedRoots.join(', ')}.`);
}

async function collectTypeScriptFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    if (ignoredDirectories.has(entry.name)) continue;

    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectTypeScriptFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

function describeFinding(file: string, source: string, index: number): Finding {
  const beforeMatch = source.slice(0, index);
  const line = beforeMatch.split('\n').length;
  const lineStart = beforeMatch.lastIndexOf('\n') + 1;
  const lineEnd = source.indexOf('\n', lineStart);
  const column = index - lineStart + 1;
  const snippet = source.slice(lineStart, lineEnd === -1 ? source.length : lineEnd).trim();

  return {
    file: relative('.', file),
    line,
    column,
    snippet
  };
}

function stripNonCode(source: string): string {
  let output = '';
  let state: ScanState = 'code';

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const nextCharacter = source[index + 1];

    if (state === 'code') {
      if (character === "'") {
        output += ' ';
        state = 'single';
        continue;
      }
      if (character === '"') {
        output += ' ';
        state = 'double';
        continue;
      }
      if (character === '`') {
        output += ' ';
        state = 'template';
        continue;
      }
      if (character === '/' && nextCharacter === '/') {
        output += '  ';
        index += 1;
        state = 'line';
        continue;
      }
      if (character === '/' && nextCharacter === '*') {
        output += '  ';
        index += 1;
        state = 'block';
        continue;
      }

      output += character;
      continue;
    }

    if (state === 'line') {
      if (character === '\n') {
        output += '\n';
        state = 'code';
      } else {
        output += ' ';
      }
      continue;
    }

    if (state === 'block') {
      if (character === '*' && nextCharacter === '/') {
        output += '  ';
        index += 1;
        state = 'code';
      } else {
        output += character === '\n' ? '\n' : ' ';
      }
      continue;
    }

    if (character === '\\') {
      output += ' ';
      if (nextCharacter) {
        output += nextCharacter === '\n' ? '\n' : ' ';
        index += 1;
      }
      continue;
    }

    if (state === 'single' && character === "'") {
      output += ' ';
      state = 'code';
      continue;
    }

    if (state === 'double' && character === '"') {
      output += ' ';
      state = 'code';
      continue;
    }

    if (state === 'template' && character === '`') {
      output += ' ';
      state = 'code';
      continue;
    }

    output += character === '\n' ? '\n' : ' ';
  }

  return output;
}
