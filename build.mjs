// Builds _site/ from the blog post markdown and the files in site/ and public/.
import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { marked } from 'marked';
import sharp from 'sharp';

const SOURCE = 'resources/Who Is Speaking.md';
const OUT_DIR = '_site';
const SITE_URL = 'https://goldilocksdesign.com/';
const PUBLISHED = '2026-10-22';
const publishedLabel = new Date(`${PUBLISHED}T12:00:00Z`)
  .toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

let md = await readFile(SOURCE, 'utf8');

// Google Docs embeds images as base64 reference definitions. Pull them out
// into compressed image files so the page itself stays light.
const images = {};
md = md.replace(/^\[(image\d+)\]: <data:image\/\w+;base64,([^>]+)>$/gm, (_, name, data) => {
  images[name] = sharp(Buffer.from(data, 'base64')).webp({ quality: 82 });
  return `[${name}]: images/${name}.webp`;
});

// The draft is a Google Docs export, which backslash-escapes characters
// inside URLs. Unescape them so they autolink cleanly.
md = md.replace(/https?\\?:\/\/\S+/g, (url) => url.replace(/\\/g, ''));

let html = marked.parse(md);

// Curly double quotes in text (not inside tags).
html = html.replace(/>([^<]+)</g, (_, text) =>
  '>' + text.replace(/(^|[\s(\[—–-])&quot;/g, '$1“').replace(/&quot;/g, '”') + '<'
);

// Headings are bolded in the source; let CSS handle their weight.
html = html.replace(/<(h[1-6])>\s*<strong>(.*?)<\/strong>\s*<\/\1>/g, '<$1>$2</$1>');

// Figures. Captions, credits and alt text live in site/figures.json. Entries
// named like the export's images (image1, image2) describe those; entries with
// a `src` are extra images from public/images, placed next to the paragraph
// containing `near`. Citations like [14] in captions link to the references.
const figures = JSON.parse(await readFile('site/figures.json', 'utf8'));
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
const imageSizes = Object.fromEntries(await Promise.all(
  Object.entries(images).map(async ([name, img]) => [name, await img.clone().metadata()])
));
html = html.replace(
  /<p><img src="images\/(image\d+)\.webp" alt="">(?:<br>)?\s*(?:<em>([\s\S]*?)<\/em>)?<\/p>/g,
  (_, name, source) => {
    const url = source && stripTags(source).trim();
    const credit = figures[name]?.credit ??
      (url ? `Source: <a href="${url}">${new URL(url).hostname.replace(/^(www|en)\./, '')}</a>` : '');
    return figureHtml(`images/${name}.webp`, imageSizes[name], { ...figures[name], credit });
  }
);

// A paragraph that is only bold text (the AI use statement) is a closing note.
html = html.replace(
  /<p><strong>([^<]+)<\/strong><\/p>\s*<p>([\s\S]*?)<\/p>/g,
  '<section class="endnote"><h3>$1</h3><p>$2</p></section>'
);

// Pull out the title and give the h2s anchor ids.
function stripTags(s) { return s.replace(/<[^>]+>/g, ''); }
const title = stripTags(html.match(/<h1>(.*?)<\/h1>/)[1]);
const subtitle = stripTags(html.match(/<\/h1>\s*<p>(.*?)<\/p>/)[1]);
const slug = (s) => stripTags(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// Essay sections are numbered for wayfinding, in Roman numerals so they are
// not confused with citation numbers; the references are not numbered.
const roman = (n) => [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]
  .reduce((out, [value, numeral]) => { while (n >= value) { out += numeral; n -= value; } return out; }, '');
const sections = [];
html = html.replace(/<h2>(.*?)<\/h2>/g, (_, text) => {
  const id = slug(text);
  const n = id === 'references' ? '' : roman(sections.filter((s) => s.n).length + 1);
  sections.push({ id, text, n });
  const num = n ? `<span class="section-num">${n}</span>` : '';
  return `<h2 id="${id}">${num}${text}</h2>`;
});

let [essay, references = ''] = html.split(/(?=<h2 id="references">)/);

const words = stripTags(essay.replace(/<figcaption>[\s\S]*?<\/figcaption>/g, '')).split(/\s+/).filter(Boolean).length;
const minutes = Math.round(words / 230);

// Give each reference an id to land on, and build a short form of it
// ("Heider and Simmel 1944, An Experimental Study…") for the margin notes.
const refs = {};
let refCount = 0;
references = references.replace(/<li>([\s\S]*?)<\/li>/g, (_, body) => {
  const n = ++refCount;
  refs[n] = shortRef(body.trim());
  return `<li id="ref-${n}">${body.trim()}</li>`;
});

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

// Place a block before or after the first paragraph containing `near`.
function placeNear({ near, place }, block, what) {
  let found = false;
  essay = essay.replace(/<p>[\s\S]*?<\/p>\n?/g, (p) => {
    if (found || !p.includes(near)) return p;
    found = true;
    return place === 'after' ? p + block : block + p;
  });
  if (!found) throw new Error(`${what} anchor not found: "${near}"`);
}

// Extra figures from public/images.
for (const [name, fig] of Object.entries(figures)) {
  if (!fig.src) continue;
  const size = await sharp(`public/${fig.src}`).metadata();
  placeNear(fig, figureHtml(fig.src, size, fig) + '\n', `Figure ${name}`);
}

// Pull quotes: display copies of lines from the essay, placed before or after
// the paragraph containing `near`. The essay text itself is untouched.
const pullquotes = JSON.parse(await readFile('site/pullquotes.json', 'utf8'));
for (const q of pullquotes) {
  placeNear(q, `<aside class="pullquote" aria-hidden="true"><p>${q.text}</p></aside>\n`, 'Pull quote');
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
    return notes.length ? cite + `<span class="sidenote" aria-hidden="true">${notes.join('')}</span>` : cite;
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
  s.replaceChildren(...a.flatMap((el, i) => (i ? [', ', el] : [el])));
})();</script>`;
html = html.replace(
  /<h1>(.*?)<\/h1>\s*<p>(.*?)<\/p>\s*<p>(.*?)<\/p>\s*<p>/s,
  `<header><p class="kicker">Inaugural essay</p><h1>$1</h1><p class="subtitle">$2</p><p class="byline"><span class="authors">$3</span> · <time datetime="${PUBLISHED}">${publishedLabel}</time> · ${minutes} min read</p>${shuffleAuthors}</header>\n<p class="lede">`
);

const toc = sections
  .map((s) => `<li><a href="#${s.id}"><span class="toc-num">${s.n}</span>${s.text}</a></li>`)
  .join('\n');

const description = 'Why the persona LLMs adopt changes the epistemic status of what the machine produces, and why designing it away is an epistemic project, not an aesthetic one.';

const [template, style, script] = await Promise.all(
  ['site/template.html', 'site/style.css', 'site/script.js'].map((f) => readFile(f, 'utf8'))
);
const page = template
  .replace('{{style}}', () => style)
  .replace('{{script}}', () => script)
  .replace('{{toc}}', () => toc)
  .replace('{{content}}', () => html)
  .replaceAll('{{title}}', title)
  .replaceAll('{{subtitle}}', subtitle)
  .replaceAll('{{description}}', description)
  .replaceAll('{{url}}', SITE_URL)
  .replaceAll('{{published}}', PUBLISHED)
  .replaceAll('{{year}}', PUBLISHED.slice(0, 4))
  .replaceAll('{{minutes}}', String(minutes));

await rm(OUT_DIR, { recursive: true, force: true });
await mkdir(OUT_DIR, { recursive: true });
await cp('public', OUT_DIR, { recursive: true });
await mkdir(`${OUT_DIR}/images`, { recursive: true });
await Promise.all(Object.entries(images).map(([name, img]) => img.toFile(`${OUT_DIR}/images/${name}.webp`)));
await writeFile(`${OUT_DIR}/index.html`, page);
console.log(`Built ${OUT_DIR}/index.html (${words} words, ~${minutes} min read, ${refCount} references)`);
