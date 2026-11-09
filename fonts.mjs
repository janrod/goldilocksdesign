// Subsets Noto Serif JP (the Japanese release of Source Han Serif, whose
// design accompanies Source Serif) to the characters the Japanese edition
// uses, and writes public/fonts/noto-serif-jp.woff2 plus the list of
// characters it covers, which the build checks against. Also writes
// noto-serif-jp-ui.woff2, a few glyphs for the English page's language switch.
//
// Run after editing the Japanese text: npm run fonts
// The full font (~13 MB, SIL Open Font License) is downloaded once into .cache/.
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Latin letters, digits and Western punctuation come from Source Serif 4;
// the subset holds kana, kanji, CJK punctuation and full-width forms, plus
// the dashes Japanese sets at full width.
export function japaneseChars(text) {
  return new Set([...text].filter((c) => {
    const cp = c.codePointAt(0);
    return (cp >= 0x2e80 && cp !== 0xfeff && !(cp >= 0xfe00 && cp <= 0xfe0f)) || [0x2015, 0x2025, 0x2026].includes(cp);
  }));
}

const FONT_URL = 'https://github.com/google/fonts/raw/main/ofl/notoserifjp/NotoSerifJP%5Bwght%5D.ttf';
const CACHE = '.cache/NotoSerifJP.ttf';

async function main() {
  const { default: subsetFont } = await import('subset-font');
  try {
    await access(CACHE);
  } catch {
    console.log(`Downloading ${FONT_URL}`);
    const res = await fetch(FONT_URL);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    await mkdir('.cache', { recursive: true });
    await writeFile(CACHE, Buffer.from(await res.arrayBuffer()));
  }
  const font = await readFile(CACHE);

  const strings = JSON.parse(await readFile('site/strings.json', 'utf8'));
  const ja = strings.ja;
  const sources = await Promise.all(
    [ja.source, ja.figures, ja.pullquotes, 'site/og.ja.html'].map((f) => readFile(f, 'utf8'))
  );
  const chars = japaneseChars([...sources, JSON.stringify(ja)].join(''));
  // The year/month/day in the Japanese date, built in build.mjs.
  for (const c of '年月日') chars.add(c);
  const text = [...chars].sort().join('');

  const subset = await subsetFont(font, text, {
    targetFormat: 'woff2',
    variationAxes: { wght: { min: 400, max: 700 } },
  });
  await writeFile('public/fonts/noto-serif-jp.woff2', subset);
  await writeFile('public/fonts/noto-serif-jp.txt', text + '\n');
  console.log(`Wrote public/fonts/noto-serif-jp.woff2 (${chars.size} characters, ${Math.round(subset.length / 1024)} KB)`);

  const label = strings.en.switchTo.label;
  const ui = await subsetFont(font, label, { targetFormat: 'woff2', variationAxes: { wght: 400 } });
  await writeFile('public/fonts/noto-serif-jp-ui.woff2', ui);
  console.log(`Wrote public/fonts/noto-serif-jp-ui.woff2 (“${label}”, ${Math.round(ui.length / 1024)} KB)`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
