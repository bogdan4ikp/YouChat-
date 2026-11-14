const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'aurora-src', 'assets', 'logo.jpg');
const cssPath = path.join(root, 'aurora-src', 'styles.css');

const b64 = fs.readFileSync(src).toString('base64');
let css = fs.readFileSync(cssPath, 'utf8');

const marker = /background-image:url\("data:image\/jpeg;base64,[^"]*"\)/;
if (!marker.test(css)) {
  console.error('не нашёл место для логотипа в styles.css');
  process.exit(1);
}
css = css.replace(marker, `background-image:url("data:image/jpeg;base64,${b64}")`);
fs.writeFileSync(cssPath, css);
console.log('логотип встроен, base64:', b64.length, 'символов');
