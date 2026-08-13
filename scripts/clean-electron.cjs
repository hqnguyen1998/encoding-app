const { rmSync } = require('node:fs');
const path = require('node:path');

const output = path.resolve(__dirname, '..', 'dist-electron');
if (path.basename(output) !== 'dist-electron') {
  throw new Error(`Từ chối dọn thư mục ngoài phạm vi build: ${output}`);
}
rmSync(output, { recursive: true, force: true });
