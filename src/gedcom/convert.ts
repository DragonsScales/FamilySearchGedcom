import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseGedcom } from './parser.js';

function getArg(name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = process.argv.findIndex((arg) => arg === name);
  if (index !== -1) return process.argv[index + 1];

  return undefined;
}

async function main(): Promise<void> {
  const input = getArg('--input') ?? process.argv[2];
  if (!input) {
    throw new Error('Usage: npm run gedcom:convert -- --input "tree.ged" --output .local/gedcom.json');
  }

  const output = getArg('--output') ?? '.local/gedcom.normalized.json';
  const gedcomText = await readFile(resolve(input), 'utf8');
  const document = parseGedcom(gedcomText);

  await writeFile(resolve(output), `${JSON.stringify(document, null, 2)}\n`, 'utf8');

  console.log(`Converted ${document.people.length} people and ${document.families.length} families.`);
  console.log(`Wrote ${resolve(output)}`);
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
