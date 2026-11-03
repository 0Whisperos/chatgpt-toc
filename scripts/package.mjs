import { readdir, readFile, writeFile } from 'node:fs/promises';
import { zipSync } from 'fflate';

const entries = {};
for (const filename of (await readdir('dist')).sort()) {
  entries[`dist/${filename}`] = await readFile(`dist/${filename}`);
}
const zip = zipSync(entries, { level: 9, mtime: new Date('2020-01-01T00:00:00Z') });
await writeFile('chatgpt-toc-navigator.zip', zip);
console.log(`Packaged chatgpt-toc-navigator.zip (${zip.length} bytes)`);
