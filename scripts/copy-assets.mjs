// Копирует JSON-базу шаблонов из src/templates → dist/templates.
// Запускается на шаге npm run build, чтобы CLI работал после сборки (риск R6).
import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const srcDir = path.join(rootDir, 'src', 'templates');
const distDir = path.join(rootDir, 'dist', 'templates');

await mkdir(distDir, { recursive: true });
await cp(srcDir, distDir, { recursive: true });
console.log(`[copy-assets] Скопировано: ${srcDir} -> ${distDir}`);
