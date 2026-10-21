// Renders site/og.html to public/og.png (the link preview image) with headless Chrome.
// Set CHROME to the browser binary if it isn't at the default macOS location.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

execFileSync(chrome, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--allow-file-access-from-files',
  '--force-device-scale-factor=1',
  '--window-size=1200,630',
  '--virtual-time-budget=3000',
  `--screenshot=${resolve('public/og.png')}`,
  `file://${resolve('site/og.html')}`,
], { stdio: 'ignore' });

console.log('Wrote public/og.png');
