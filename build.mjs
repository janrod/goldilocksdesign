// Builds _site/index.html from the blog post markdown.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { marked } from 'marked';

const SOURCE = 'resources/Who Is Speaking.md';
const OUT_DIR = '_site';

let md = await readFile(SOURCE, 'utf8');

// The draft is a Google Docs export, which backslash-escapes characters
// inside URLs. Unescape them so they autolink cleanly.
md = md.replace(/https?\\?:\/\/\S+/g, (url) => url.replace(/\\/g, ''));

let html = marked.parse(md);

// Curly double quotes in text (not inside tags).
html = html.replace(/>([^<]+)</g, (_, text) =>
  '>' + text.replace(/(^|[\s(\[—–-])&quot;/g, '$1\u201C').replace(/&quot;/g, '\u201D') + '<'
);

// Headings are bolded in the source; let CSS handle their weight.
html = html.replace(/<(h[1-6])>\s*<strong>(.*?)<\/strong>\s*<\/\1>/g, '<$1>$2</$1>');

// Pull out the title and give the h2s anchor ids.
const title = html.match(/<h1>(.*?)<\/h1>/)[1].replace(/<[^>]+>/g, '');
const slug = (s) => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
html = html.replace(/<h2>(.*?)<\/h2>/g, (_, text) => `<h2 id="${slug(text)}">${text}</h2>`);

// Link in-text citations like [14] or [25, 30] to the reference list,
// and give each reference an id to land on.
const [essay, references = ''] = html.split(/(?=<h2 id="references">)/);
const linkedEssay = essay.replace(/\[(\d+(?:,\s*\d+)*)\]/g, (_, nums) =>
  '<span class="cite">[' +
  nums.split(/,\s*/).map((n) => `<a href="#ref-${n}">${n}</a>`).join(', ') +
  ']</span>'
);
let n = 0;
const linkedReferences = references.replace(/<li>/g, () => `<li id="ref-${++n}">`);
html = linkedEssay + linkedReferences;

// The first paragraph after the title is the subtitle; the next is the byline.
html = html.replace(
  /<h1>(.*?)<\/h1>\s*<p>(.*?)<\/p>\s*<p>(.*?)<\/p>/s,
  '<header><h1>$1</h1><p class="subtitle">$2</p><p class="byline">$3</p></header>'
);

const words = essay.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
const minutes = Math.round(words / 230);
const description = 'Why the persona LLMs adopt changes the epistemic status of what the machine produces, and why designing it away is an epistemic project, not an aesthetic one.';

const template = await readFile('template.html', 'utf8');
const page = template
  .replaceAll('{{title}}', title)
  .replaceAll('{{description}}', description)
  .replaceAll('{{minutes}}', String(minutes))
  .replace('{{content}}', html);

await mkdir(OUT_DIR, { recursive: true });
await writeFile(`${OUT_DIR}/index.html`, page);
console.log(`Built ${OUT_DIR}/index.html (${words} words, ~${minutes} min read)`);
