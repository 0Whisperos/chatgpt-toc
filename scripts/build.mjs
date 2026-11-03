import { build } from 'vite';
import { mkdir, copyFile } from 'node:fs/promises';
for (const [name, entry] of [['bridge', 'src/bridge.ts'], ['content', 'src/content.ts']]) {
  await build({
    configFile: false,
    build: {
      outDir: 'dist', emptyOutDir: name === 'bridge', target: 'chrome111',
      lib: { entry, name: `ChatGPTTOC_${name}`, formats: ['iife'], fileName: () => `${name}.js` },
      minify: true,
    },
  });
}
await mkdir('dist', { recursive: true });
await copyFile('manifest.json', 'dist/manifest.json');
await copyFile('README.md', 'dist/README.md');
await copyFile('README.en.md', 'dist/README.en.md');
await copyFile('README.md', 'dist/安装说明.md');
await copyFile('VALIDATION.md', 'dist/验证记录.md');
