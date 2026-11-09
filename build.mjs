// Builds _site/ from the essay markdown and the files in site/ and public/.
// The English edition is the source of truth and is served at /; the
// Japanese edition (resources/Who Is Speaking.ja.md) is served at /ja/. Both
// share the images, the reference list and the section ids, and each takes
// its interface text from site/strings.json.
import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { marked } from 'marked';
import sharp from 'sharp';
import { loadDefaultJapaneseParser } from 'budoux';

const OUT_DIR = '_site';
const SITE_URL = 'https://goldilocksdesign.com/';
const PUBLISHED = '2026-10-22';
const EDITIONS = { en: '', ja: 'ja/' }; // language → path under the site root
const strings = JSON.parse(await readFile('site/strings.json', 'utf8'));
const [template, style, script] = await Promise.all(
  ['site/template.html', 'site/style.css', 'site/script.js'].map((f) => readFile(f, 'utf8'))
);

function stripTags(s) { return s.replace(/<[^>]+>/g, ''); }
const slug = (s) => stripTags(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Google Docs embeds images as base64 reference definitions. Pull them out
// of the English draft into compressed image files so the page stays light.
const images = {};
const englishMd = (await readFile(strings.en.source, 'utf8'))
  .replace(/^\[(image\d+)\]: <data:image\/\w+;base64,([^>]+)>$/gm, (_, name, data) => {
    images[name] = sharp(Buffer.from(data, 'base64')).webp({ quality: 82 });
    return `[${name}]: images/${name}.webp`;
  });
const imageSizes = Object.fromEntries(await Promise.all(
  Object.entries(images).map(async ([name, img]) => [name, await img.clone().metadata()])
));

// Japanese headings and display lines break only between phrases, not
// inside words.
// BudouX finds the phrase boundaries; a few splits it makes inside set
// phrases (として, 紛れもない, 主張する者, 人のふり, 摩擦のなか) are
// glued back together.
const budoux = loadDefaultJapaneseParser();
const GLUE = [[/と$/, /^して/], [/も$/, /^な[いく]/], [/[るた]$/, /^者/], [/の$/, /^(ふり|なか)/]];
const phrases = (text, sep = '<wbr>') => budoux.parse(text)
  .reduce((out, chunk) => {
    const prev = out.at(-1);
    if (GLUE.some(([a, b]) => prev && a.test(prev) && b.test(chunk))) {
      out[out.length - 1] += chunk;
    } else {
      out.push(chunk);
    }
    return out;
  }, [])
  .join(sep);

const linkCites = (s) => s.replace(/\[(\d+(?:,\s*\d+)*)\]/g, (_, nums) =>
  '<span class="cite">[' +
  nums.split(/,\s*/).map((n) => `<a href="#ref-${n}" data-ref="${n}">${n}</a>`).join(', ') +
  ']</span>'
);
function figureHtml(src, { width, height }, { alt = '', caption = '', credit = '' }) {
  const parts = [caption && linkCites(caption), credit && `<span class="credit">${linkCites(credit)}</span>`].filter(Boolean);
  return `<figure><img src="${src}" alt="${alt.replace(/"/g, '&quot;')}" width="${width}" height="${height}" loading="lazy" decoding="async">` +
    (parts.length ? `<figcaption>${parts.join(' ')}</figcaption>` : '') + '</figure>';
}

function shortRef(body) {
  const text = stripTags(body);
  const m = text.match(/^(.*?)\.\s+(\d{4})\.\s+/);
  if (!m) return text;
  const [, authors, year] = m;
  // Court cases lead with the italicised case name and have no separate title.
  if (body.startsWith('<em>')) return `<i>${body.match(/^<em>(.*?)<\/em>/)[1]}</i> ${year}`;

  const etAl = /,?\s*et al$/.test(authors);
  const names = authors.replace(/,?\s*et al$/, '').split(/,\s*(?:and\s+)?|\s+and\s+/);
  const surname = (name) => {
    const w = name.trim().split(/\s+/);
    const particle = w.findIndex((x, i) => i > 0 && /^(de|di|da|du|del|della|van|von|le|la)$/i.test(x));
    return w.slice(particle > 0 ? particle : -1).join(' ');
  };
  const who = etAl || names.length > 2
    ? `${surname(names[0])} et al.`
    : names.map(surname).join(' and ');

  const rest = body.slice(body.indexOf(`${year}.`) + year.length + 1).trim();
  const titleHtml = rest.startsWith('<em>')
    ? `<i>${rest.match(/^<em>(.*?)<\/em>/)[1]}</i>`
    : stripTags(rest).match(/^(.*?)[.?!](\s|$)/)?.[1] ?? '';
  return `${who} ${year}, ${titleHtml}`;
}

// The reference list, numbered ids and the short forms for the margin
// notes come from the English edition and are reused by the others.
let shared;

async function buildEdition(lang) {
  const t = strings[lang];
  const ja = lang === 'ja';
  const dir = EDITIONS[lang];
  const root = '../'.repeat(dir.split('/').filter(Boolean).length);
  const url = SITE_URL + dir;

  let md = lang === 'en' ? englishMd : await readFile(t.source, 'utf8');

  // The draft is a Google Docs export, which backslash-escapes characters
  // inside URLs. Unescape them so they autolink cleanly.
  md = md.replace(/https?\\?:\/\/\S+/g, (u) => u.replace(/\\/g, ''));

  let html = marked.parse(md);

  // Curly double quotes in text (not inside tags).
  html = html.replace(/>([^<]+)</g, (_, text) =>
    '>' + text.replace(/(^|[\s(\[—–-])&quot;/g, '$1“').replace(/&quot;/g, '”') + '<'
  );

  // Headings are bolded in the source; let CSS handle their weight.
  html = html.replace(/<(h[1-6])>\s*<strong>(.*?)<\/strong>\s*<\/\1>/g, '<$1>$2</$1>');

  // Figures. Captions, credits and alt text live in site/figures*.json.
  // Entries named like the export's images (image1, image2) describe those;
  // entries with a `src` are extra images from public/images, placed next to
  // the paragraph containing `near`. Citations like [14] in captions link to
  // the references.
  const figures = JSON.parse(await readFile(t.figures, 'utf8'));
  html = html.replace(
    /<p><img src="images\/(image\d+)\.webp" alt="">(?:<br>)?\s*(?:<em>([\s\S]*?)<\/em>)?<\/p>/g,
    (_, name, source) => {
      const src = source && stripTags(source).trim();
      const credit = figures[name]?.credit ??
        (src ? `Source: <a href="${src}">${new URL(src).hostname.replace(/^(www|en)\./, '')}</a>` : '');
      return figureHtml(`images/${name}.webp`, imageSizes[name], { ...figures[name], credit });
    }
  );

  // A paragraph that is only bold text (the AI use statement) is a closing note.
  html = html.replace(
    /<p><strong>([^<]+)<\/strong><\/p>\s*<p>([\s\S]*?)<\/p>/g,
    '<section class="endnote"><h3>$1</h3><p>$2</p></section>'
  );

  // Pull out the title and give the h2s anchor ids. Translations reuse the
  // English ids, so a link to a section works in every edition.
  const title = stripTags(html.match(/<h1>(.*?)<\/h1>/)[1]);
  const subtitle = stripTags(html.match(/<\/h1>\s*<p>(.*?)<\/p>/)[1]);
  const sections = [];
  html = html.replace(/<h2>(.*?)<\/h2>/g, (_, text) => {
    const id = shared ? shared.sections[sections.length]?.id : slug(text);
    if (!id) throw new Error(`${lang}: more sections than the English edition`);
    sections.push({ id, text });
    return `<h2 id="${id}">${ja ? phrases(text) : text}</h2>`;
  });
  if (shared && sections.length !== shared.sections.length) {
    throw new Error(`${lang}: ${sections.length} sections, the English edition has ${shared.sections.length}`);
  }

  let [essay, references = ''] = html.split(/(?=<h2 id="references">)/);

  const essayText = stripTags(essay.replace(/<figcaption>[\s\S]*?<\/figcaption>/g, ''));
  const words = essayText.split(/\s+/).filter(Boolean).length;
  // About 230 words a minute in English, 500 characters a minute in Japanese.
  const minutes = ja
    ? Math.round(essayText.replace(/\s/g, '').length / 500)
    : Math.round(words / 230);

  if (!shared) {
    // Give each reference an id to land on, and build a short form of it
    // ("Heider and Simmel 1944, An Experimental Study…") for the margin notes.
    const refs = {};
    let refCount = 0;
    references = references.replace(/<li>([\s\S]*?)<\/li>/g, (_, body) => {
      const n = ++refCount;
      refs[n] = shortRef(body.trim());
      return `<li id="ref-${n}">${body.trim()}</li>`;
    });
    shared = { sections, refs, refCount, list: references.match(/<ol>[\s\S]*<\/ol>/)[0] };
  } else {
    // Translations list the references in their original language.
    references = references.replace(/<\/h2>[\s\S]*$/, '</h2>\n') + shared.list.replace('<ol>', '<ol lang="en">') + '\n';
  }
  const { refs } = shared;

  // Place a block before or after the first paragraph containing `near`.
  function placeNear({ near, place }, block, what) {
    let found = false;
    essay = essay.replace(/<p>[\s\S]*?<\/p>\n?/g, (p) => {
      if (found || !p.includes(near)) return p;
      found = true;
      return place === 'after' ? p + block : block + p;
    });
    if (!found) throw new Error(`${lang}: ${what} anchor not found: "${near}"`);
  }

  // Extra figures from public/images.
  for (const [name, fig] of Object.entries(figures)) {
    if (!fig.src) continue;
    const size = await sharp(`public/${fig.src}`).metadata();
    placeNear(fig, figureHtml(fig.src, size, fig) + '\n', `Figure ${name}`);
  }

  // Pull quotes: display copies of lines from the essay, placed before or
  // after the paragraph containing `near`. The essay text itself is
  // untouched. Japanese quotes carry zero-width spaces between phrases, the
  // only places they may wrap.
  const pullquotes = JSON.parse(await readFile(t.pullquotes, 'utf8'));
  for (const q of pullquotes) {
    const text = ja ? phrases(q.text, '​') : q.text;
    placeNear(q, `<aside class="pullquote" aria-hidden="true"><p>${text}</p></aside>\n`, 'Pull quote');
  }

  // Link in-text citations like [14] or [25, 30] to the reference list, and
  // float a margin note next to each one (shown on wide screens). A reference
  // gets one note per paragraph, even if it is cited there more than once.
  essay = essay.replace(/<p>([\s\S]*?)<\/p>/g, (_, para) => {
    const noted = new Set();
    para = para.replace(/\[(\d+(?:,\s*\d+)*)\]/g, (_, nums) => {
      const ns = nums.split(/,\s*/);
      const cite = '<span class="cite">[' +
        ns.map((n) => `<a href="#ref-${n}" data-ref="${n}">${n}</a>`).join(', ') +
        ']</span>';
      const notes = ns.filter((n) => !noted.has(n) && refs[n]).map((n) => {
        noted.add(n);
        return `<span class="sn" data-ref="${n}"><a href="#ref-${n}" tabindex="-1">${n}</a> ${refs[n]}</span>`;
      });
      return notes.length
        ? cite + `<span class="sidenote" aria-hidden="true"${ja ? ' lang="en"' : ''}>${notes.join('')}</span>`
        : cite;
    });
    return `<p>${para}</p>`;
  });

  html = essay + references;

  // The first paragraph after the title is the subtitle; the next is the byline.
  // The authors are shuffled on each page load, inline so the order is set
  // before first paint.
  const shuffleAuthors = `<script>(() => {
  const s = document.currentScript.previousElementSibling.querySelector('.authors');
  const a = [...s.querySelectorAll('a')];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  s.replaceChildren(...a.flatMap((el, i) => (i ? [${JSON.stringify(t.authorSeparator)}, el] : [el])));
})();</script>`;
  const date = new Date(`${PUBLISHED}T12:00:00Z`);
  const dateLabel = ja
    ? `${date.getUTCFullYear()}年${date.getUTCMonth() + 1}月${date.getUTCDate()}日`
    : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const readLabel = t.script.minRead.replace('{n}', minutes);
  html = html.replace(
    /<h1>(.*?)<\/h1>\s*<p>(.*?)<\/p>\s*<p>(.*?)<\/p>\s*<p>/s,
    (_, h1, sub, authors) =>
      `<header><p class="kicker">${t.kicker}</p><h1>${ja ? phrases(h1) : h1}</h1>` +
      `<p class="subtitle">${ja ? phrases(sub) : sub}</p>` +
      `<p class="byline"><span class="authors">${authors}</span> · <time datetime="${PUBLISHED}">${dateLabel}</time> · ${readLabel}</p>${shuffleAuthors}</header>\n` +
      // The opening paragraph gets a drop cap, which Japanese doesn't use.
      (ja ? '<p>' : '<p class="lede">')
  );

  // Pages in a subdirectory reach the shared files one level up.
  html = html.replace(/(<img src=")(images\/)/g, `$1${root}$2`);

  const toc = sections
    .map((s) => `<li><a href="#${s.id}">${ja ? phrases(s.text) : s.text}</a></li>`)
    .join('\n');

  // The language menu (each edition named in its own language), and the
  // other editions for search engines.
  const globe = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9M12 3c-2.5 2.6-3.8 5.6-3.8 9s1.3 6.4 3.8 9"/></svg>';
  const langItems = Object.entries(EDITIONS)
    .map(([l, d]) => `<li><a href="${root + d || './'}" hreflang="${l}" lang="${l}"${l === lang ? ' aria-current="page"' : ''}>${strings[l].name}</a></li>`)
    .join('');
  const langSwitch = `<div class="lang-menu">
      <button type="button" class="lang-toggle" aria-expanded="false" aria-controls="lang-list" aria-label="${t.languageLabel}" title="${t.languageLabel}">${globe}</button>
      <ul class="lang-list" id="lang-list">${langItems}</ul>
    </div>`;
  const alternates = [
    ...Object.entries(EDITIONS).map(([l, d]) => `<link rel="alternate" hreflang="${l}" href="${SITE_URL + d}">`),
    `<link rel="alternate" hreflang="x-default" href="${SITE_URL}">`,
    ...Object.keys(EDITIONS).filter((l) => l !== lang)
      .map((l) => `<meta property="og:locale:alternate" content="${strings[l].locale}">`),
  ].join('\n  ');

  // Typefaces: Source Serif 4 everywhere; the Japanese edition adds Noto
  // Serif JP (Source Han Serif, Source Serif's CJK companion), subset to the
  // characters it uses. The English page needs only the language menu's “日本語”.
  const fonts = [
    ['400 1em "Source Serif 4"'], ['italic 400 1em "Source Serif 4"'], ['600 1em "Source Serif 4"'],
    ...(ja
      ? [['400 1em "Noto Serif JP GD"', '本'], ['600 1em "Noto Serif JP GD"', '本']]
      : [['400 1em "Noto Serif JP UI"', strings.ja.name]]),
  ];
  const preloads = ['source-serif-4-roman', 'source-serif-4-italic', ja ? 'noto-serif-jp' : 'noto-serif-jp-ui']
    .map((f) => `<link rel="preload" href="${root}fonts/${f}.woff2" as="font" type="font/woff2" crossorigin>`)
    .join('\n  ');

  const ogImage = SITE_URL + (ja ? 'ja/' : '') + 'og.png';
  const fill = (s) => s.replace('{title}', title).replace('{subtitle}', subtitle);
  const vars = {
    lang, url, title, subtitle, minutes, root, toc, langSwitch, alternates, preloads, ogImage,
    content: html,
    style: style.replace(/url\("fonts\//g, `url("${root}fonts/`),
    script,
    fonts: JSON.stringify(fonts),
    strings: JSON.stringify({ ...t.script, track: ja ? 'ja-' : '' }),
    description: t.description,
    ogAlt: fill(t.ogAlt),
    locale: t.locale,
    kicker: t.kicker,
    preamble: t.preamble,
    tocLabel: t.tocLabel,
    print: t.print,
    readLabel,
    toDark: t.script.toDark,
    home: '/' + dir,
    published: PUBLISHED,
    year: PUBLISHED.slice(0, 4),
    // Only the English page, which is where links usually land, sends
    // readers on to the Japanese edition (see the script in the template).
    detect: lang === 'en' ? 'true' : 'false',
    jaHref: EDITIONS.ja,
  };
  const page = template.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  const missing = page.match(/\{\{\w+\}\}/);
  if (missing) throw new Error(`${lang}: no value for ${missing[0]} in the template`);

  if (ja) await checkGlyphs(page);

  await mkdir(`${OUT_DIR}/${dir}`, { recursive: true });
  await writeFile(`${OUT_DIR}/${dir}index.html`, page);
  const size = ja ? `${essayText.replace(/\s/g, '').length} characters` : `${words} words`;
  console.log(`Built ${OUT_DIR}/${dir}index.html (${size}, ~${minutes} min read, ${shared.refCount} references)`);
}

// The Japanese font is subset to the characters the edition uses (npm run
// fonts). Fail if the text has gained characters the subset doesn't cover,
// rather than let them fall back to another typeface.
async function checkGlyphs(page) {
  const covered = new Set(await readFile('public/fonts/noto-serif-jp.txt', 'utf8'));
  const { japaneseChars } = await import('./fonts.mjs');
  const text = page.replace(/<(script|style)[\s\S]*?<\/\1>/g, '').replace(/<[^>]+>/g, '');
  const missing = [...japaneseChars(text)].filter((c) => !covered.has(c));
  if (missing.length) {
    throw new Error(`The Japanese font subset is missing ${missing.join('')}. Run \`npm run fonts\` and commit public/fonts.`);
  }
}

await rm(OUT_DIR, { recursive: true, force: true });
await mkdir(OUT_DIR, { recursive: true });
await cp('public', OUT_DIR, { recursive: true });
await mkdir(`${OUT_DIR}/images`, { recursive: true });
await Promise.all(Object.entries(images).map(([name, img]) => img.toFile(`${OUT_DIR}/images/${name}.webp`)));
for (const lang of Object.keys(EDITIONS)) await buildEdition(lang);
// The subset's character list is only for the build.
await rm(`${OUT_DIR}/fonts/noto-serif-jp.txt`, { force: true });
