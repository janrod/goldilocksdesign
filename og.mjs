// Renders the link preview images with headless Chrome: site/og.html to
// public/og.png and site/og.ja.html to public/ja/og.png.
// Set CHROME to the browser binary if it isn't at the default macOS location.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// A throwaway profile, so a Chrome that is already open doesn't interfere.
const profile = mkdtempSync(join(tmpdir(), 'og-chrome-'));

for (const [source, out] of [['site/og.html', 'public/og.png'], ['site/og.ja.html', 'public/ja/og.png']]) {
  mkdirSync(resolve(out, '..'), { recursive: true });
  const started = Date.now();
  try {
    execFileSync(chrome, [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--allow-file-access-from-files',
      '--force-device-scale-factor=1',
      '--window-size=1200,630',
      '--virtual-time-budget=3000',
      `--user-data-dir=${profile}`,
      `--screenshot=${resolve(out)}`,
      `file://${resolve(source)}`,
    ], { stdio: 'ignore' });
  } catch (err) {
    // Chrome sometimes crashes while shutting down, after the screenshot is
    // written. Only fail if the image wasn't written.
    let written = false;
    try { written = statSync(out).mtimeMs >= started; } catch {}
    if (!written) throw err;
  }
  console.log(`Wrote ${out}`);
}
rmSync(profile, { recursive: true, force: true });
