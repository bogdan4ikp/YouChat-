'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'aurora-src');
const OUT = path.join(ROOT, 'YouChat.html');

const html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');

const used = [];

const inlined = html
  .replace(/<link rel="stylesheet" href="([^"]+)">/g, (match, href) => {
    const file = path.join(SRC, href);
    const css = fs.readFileSync(file, 'utf8');
    used.push(href);
    return `<style>\n/* ${href} */\n${css}\n</style>`;
  })
  .replace(/<script src="([^"]+)"><\/script>/g, (match, src) => {
    const file = path.join(SRC, src);
    const js = fs.readFileSync(file, 'utf8');
    if (js.includes('</script')) throw new Error(`Файл ${src} содержит </script> и не может быть встроен как есть`);
    used.push(src);
    return `<script>\n/* ${src} */\n${js}\n</script>`;
  });

if (/<script src=|<link rel="stylesheet"/.test(inlined)) {
  throw new Error('Остались внешние ссылки — проверьте index.html');
}

const banner = `<!-- Автономная сборка YouChat. Собрано ${new Date().toISOString()} из aurora-src (${used.join(', ')}). -->\n`;
fs.writeFileSync(OUT, banner + inlined, 'utf8');
const size = fs.statSync(OUT).size;
console.log(`YouChat.html: ${(size / 1024).toFixed(0)} КБ, встроено файлов: ${used.length}`);
