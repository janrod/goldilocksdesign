(() => {
  const article = document.querySelector('article');
  const header = article.querySelector('header');
  const refsHeading = document.getElementById('references');
  const totalMinutes = Number(article.dataset.minutes);
  const wide = matchMedia('(min-width: 1100px)');
  const coarse = matchMedia('(pointer: coarse)');

  // GoatCounter events (no-op until its script has loaded, and on localhost).
  const track = (path, title) => window.goatcounter?.count?.({ path, title, event: true });

  let lastPointer = 'mouse';
  addEventListener('pointerdown', (e) => { lastPointer = e.pointerType; }, true);

  // ---- Reading progress, time left, current section ----

  const bar = document.querySelector('.progress-bar');
  const preamble = document.querySelector('.preamble');
  const quotes = [...article.querySelectorAll('.pullquote')];
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const pill = document.querySelector('.time-pill');
  const toc = document.querySelector('.toc');
  const tocTime = toc.querySelector('.toc-time');
  const tocLinks = [...toc.querySelectorAll('a')];
  const headings = tocLinks.map((a) => document.getElementById(a.hash.slice(1)));
  let pillTimer;

  // A quote's slot in the text is sized for the quote at full size inside
  // its frame, so nothing around it ever moves or gets covered. Its line
  // breaks are frozen as laid out at normal size; with focus f the text
  // grows from its centre (up to 125%, within the column) and an SVG line
  // draws a rounded rectangle around it.
  const QUOTE_ZOOM = 1.25;
  const FRAME_PAD_X = 44;
  const FRAME_PAD_Y = 40;
  // The line runs clockwise from the top-left corner: it draws in while the
  // quote approaches the centre, then carries on clockwise as it leaves,
  // erasing from where it started.
  function sizeQuote(q, f, leaving) {
    const key = `${f}${leaving}`;
    if (q.f === key) return;
    q.f = key;
    q.querySelector('p').style.fontSize = `${reduceMotion.matches ? 1 : 1 + (q.zoom - 1) * f}em`;
    q.frame.style.strokeDasharray = leaving ? `0 ${1 - f} ${f} 1` : `${f} 1`;
  }

  // Split a laid-out paragraph into the lines the browser chose.
  function lineBreaks(p) {
    const node = p.firstChild;
    const text = node.data;
    const range = document.createRange();
    const lines = [];
    let lineStart = 0;
    let lastTop = null;
    for (const m of text.matchAll(/\S+/g)) {
      range.setStart(node, m.index);
      range.setEnd(node, m.index + 1);
      const top = range.getBoundingClientRect().top;
      if (lastTop !== null && top > lastTop + 2) {
        lines.push(text.slice(lineStart, m.index).trim());
        lineStart = m.index;
      }
      lastTop = top;
    }
    lines.push(text.slice(lineStart).trim());
    return lines;
  }

  // Lay quotes out at normal size, freeze the line breaks, work out how far
  // each may grow, then size its slot and frame for that. Redone when the
  // width changes.
  const SVG = 'http://www.w3.org/2000/svg';
  function layoutQuotes() {
    document.documentElement.classList.remove('js-quotes');
    for (const q of quotes) {
      const p = q.querySelector('p');
      q.dataset.text ??= p.textContent;
      p.textContent = q.dataset.text;
      p.removeAttribute('style');
      q.style.height = '';
      q.querySelector('svg')?.remove();
      q.f = undefined;
    }
    const lines = quotes.map((q) => lineBreaks(q.querySelector('p')));
    quotes.forEach((q, i) => {
      q.querySelector('p').replaceChildren(...lines[i].map((line) =>
        Object.assign(document.createElement('span'), { className: 'quote-line', textContent: line })));
    });
    document.documentElement.classList.add('js-quotes');
    for (const q of quotes) {
      const p = q.querySelector('p');
      const colW = q.clientWidth;
      const w = p.offsetWidth;
      const h = p.offsetHeight;
      q.zoom = reduceMotion.matches ? 1
        : Math.max(1, Math.min(QUOTE_ZOOM, (colW - 2 * FRAME_PAD_X) / w, (innerHeight * 0.7) / h));
      const padX = Math.max(12, Math.min(FRAME_PAD_X, (colW - w * q.zoom) / 2));
      const fw = Math.round(w * q.zoom + 2 * padX);
      const fh = Math.round(h * q.zoom + 2 * FRAME_PAD_Y);
      q.style.height = `${fh}px`;

      const svg = document.createElementNS(SVG, 'svg');
      svg.classList.add('quote-frame');
      svg.setAttribute('width', fw);
      svg.setAttribute('height', fh);
      svg.setAttribute('viewBox', `0 0 ${fw} ${fh}`);
      const rect = document.createElementNS(SVG, 'rect');
      for (const [k, v] of Object.entries({ x: 0.75, y: 0.75, width: fw - 1.5, height: fh - 1.5, rx: 28, pathLength: 1 })) {
        rect.setAttribute(k, v);
      }
      svg.append(rect);
      q.prepend(svg);
      q.frame = rect;
    }
  }
  layoutQuotes();
  // Line breaks depend on the web font; lay out again once it has loaded.
  document.fonts.ready.then(() => { layoutQuotes(); requestUpdate(); });
  let lastWidth = innerWidth;
  addEventListener('resize', () => {
    if (innerWidth === lastWidth) return;
    lastWidth = innerWidth;
    layoutQuotes();
  });

  function timeLeft(f) {
    if (f <= 0) return `${totalMinutes} min read`;
    if (f >= 1) return 'Finished';
    return `${Math.max(1, Math.ceil((1 - f) * totalMinutes))} min left`;
  }

  function onScroll() {
    // Finished when the references come into view.
    const f = Math.min(1, Math.max(0, scrollY / (refsHeading.offsetTop - innerHeight)));
    bar.style.transform = `scaleX(${f})`;

    // The preamble fades out over the first stretch of scrolling.
    const fadeOver = (preamble.offsetTop + preamble.offsetHeight) * 0.6;
    preamble.style.opacity = Math.max(0, 1 - scrollY / fadeOver);
    trackDepth(f);

    // Pull quote focus: from the moment a quote enters the screen it grows
    // and a line draws itself around it, complete exactly when the quote is
    // in the middle of the screen and receding as soon as it moves past.
    for (const q of quotes) {
      const r = q.getBoundingClientRect();
      const offset = (r.top + r.height / 2 - innerHeight / 2) / (innerHeight / 2);
      sizeQuote(q, reduceMotion.matches ? 1 : Math.max(0, 1 - Math.abs(offset)), offset < 0);
    }

    const label = timeLeft(f);
    tocTime.textContent = label;
    pill.textContent = label;
    if (f > 0 && f < 1) {
      pill.classList.add('is-visible');
      clearTimeout(pillTimer);
      pillTimer = setTimeout(() => pill.classList.remove('is-visible'), 1400);
    } else {
      pill.classList.remove('is-visible');
    }

    toc.classList.toggle('is-visible', header.getBoundingClientRect().bottom < 0);
    let current = -1;
    headings.forEach((h, i) => { if (h.getBoundingClientRect().top < innerHeight * 0.35) current = i; });
    tocLinks.forEach((a, i) => {
      if (i === current) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    });
  }

  // Report how far into the essay each visit gets, once per milestone.
  const depthsSent = new Set();
  function trackDepth(f) {
    for (const pct of [25, 50, 75, 100]) {
      if (f * 100 >= pct && !depthsSent.has(pct)) {
        depthsSent.add(pct);
        track(`read-${pct}`, `Read ${pct}%`);
      }
    }
  }

  let ticking = false;
  const requestUpdate = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; onScroll(); });
  };
  addEventListener('scroll', requestUpdate, { passive: true });
  addEventListener('resize', requestUpdate);
  onScroll();
  pill.classList.remove('is-visible');


  // ---- Citation previews ----
  // Narrow screens: hover (or tap) a citation to see the reference in a card.
  // Wide screens: the margin note is already visible, so highlight it instead.

  const pop = document.createElement('div');
  pop.className = 'ref-pop';
  pop.id = 'ref-pop';
  pop.setAttribute('role', 'tooltip');
  pop.hidden = true;
  document.body.append(pop);
  let popFor = null;
  let hideTimer;

  function showPop(a) {
    const li = document.getElementById(a.hash.slice(1));
    if (!li) return;
    clearTimeout(hideTimer);
    popFor?.removeAttribute('aria-describedby');
    popFor = a;
    a.setAttribute('aria-describedby', pop.id);
    pop.innerHTML = `<span class="ref-pop-num">${a.dataset.ref}</span>${li.innerHTML}` +
      (lastPointer === 'mouse' ? '' : `<a class="ref-pop-jump" href="${a.hash}">Go to references ↓</a>`);
    pop.hidden = false;

    const r = a.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const left = Math.max(12, Math.min(r.left + r.width / 2 - pop.offsetWidth / 2, vw - pop.offsetWidth - 12));
    let top = r.bottom + 8;
    if (top + pop.offsetHeight > innerHeight - 12 && r.top - pop.offsetHeight - 8 > 12) {
      top = r.top - pop.offsetHeight - 8;
    }
    pop.style.left = `${left + scrollX}px`;
    pop.style.top = `${top + scrollY}px`;
  }

  function hidePop() {
    pop.hidden = true;
    popFor?.removeAttribute('aria-describedby');
    popFor = null;
  }
  const hideSoon = () => { clearTimeout(hideTimer); hideTimer = setTimeout(hidePop, 180); };

  function setHot(a, on) {
    a.closest('p')?.querySelectorAll(`.sn[data-ref="${a.dataset.ref}"]`)
      .forEach((sn) => sn.classList.toggle('is-hot', on));
  }

  for (const a of article.querySelectorAll('.cite a')) {
    a.addEventListener('mouseenter', () => {
      if (lastPointer !== 'mouse') return;
      if (wide.matches) setHot(a, true);
      else showPop(a);
    });
    a.addEventListener('mouseleave', () => {
      setHot(a, false);
      hideSoon();
    });
    a.addEventListener('focus', () => { if (!wide.matches) showPop(a); });
    a.addEventListener('blur', hideSoon);
    a.addEventListener('click', (e) => {
      // On touch, the first tap previews; the card links on to the references.
      if (lastPointer !== 'mouse' && !wide.matches && popFor !== a) {
        e.preventDefault();
        showPop(a);
      } else {
        hidePop();
      }
    });
  }
  pop.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  pop.addEventListener('mouseleave', hideSoon);
  pop.addEventListener('click', (e) => { if (e.target.closest('a')) hidePop(); });
  document.addEventListener('click', (e) => {
    if (!pop.hidden && !pop.contains(e.target) && !e.target.closest('.cite')) hidePop();
  });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') hidePop(); });
  addEventListener('resize', hidePop);

  // ---- Link to a selected passage (text fragments) ----

  const shareBtn = document.createElement('button');
  shareBtn.type = 'button';
  shareBtn.className = 'share-btn';
  shareBtn.hidden = true;
  document.body.append(shareBtn);
  let selectionTimer;
  let shareUrl = '';
  let shareText = '';
  let holdLabelUntil = 0;

  const encode = (s) => encodeURIComponent(s).replace(/-/g, '%2D');
  const isWordChar = (c) => /[\p{L}\p{N}]/u.test(c || '');

  function fragmentFor(range) {
    let words = range.toString().replace(/\s+/g, ' ').trim().split(' ');
    // Text fragments only match whole words, so drop words the selection cuts in half.
    const { startContainer: sc, startOffset: so, endContainer: ec, endOffset: eo } = range;
    if (sc.nodeType === 3 && isWordChar(sc.data[so - 1]) && isWordChar(sc.data[so])) words.shift();
    if (ec.nodeType === 3 && isWordChar(ec.data[eo - 1]) && isWordChar(ec.data[eo])) words.pop();
    if (words.length < 2) return null;
    const text = words.join(' ');
    const frag = words.length <= 8
      ? encode(text)
      : `${encode(words.slice(0, 4).join(' '))},${encode(words.slice(-4).join(' '))}`;
    return { url: `${location.origin}${location.pathname}#:~:text=${frag}`, text };
  }

  function updateShare() {
    if (Date.now() < holdLabelUntil) return;
    const sel = getSelection();
    if (sel.isCollapsed || !sel.rangeCount || sel.toString().trim().length < 12 ||
        !article.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      shareBtn.hidden = true;
      return;
    }
    const range = sel.getRangeAt(0);
    const frag = fragmentFor(range);
    if (!frag) { shareBtn.hidden = true; return; }
    ({ url: shareUrl, text: shareText } = frag);

    shareBtn.textContent = coarse.matches && navigator.share ? 'Share link to quote' : 'Copy link to quote';
    shareBtn.hidden = false;
    const rects = range.getClientRects();
    const first = rects[0];
    const last = rects[rects.length - 1];
    const vw = document.documentElement.clientWidth;
    // Above the selection with a mouse; below it on touch, clear of the native menu.
    const anchor = coarse.matches ? last : first;
    const top = coarse.matches ? anchor.bottom + 14 : anchor.top - shareBtn.offsetHeight - 10;
    const left = Math.max(12, Math.min(anchor.left + anchor.width / 2 - shareBtn.offsetWidth / 2, vw - shareBtn.offsetWidth - 12));
    shareBtn.style.left = `${left + scrollX}px`;
    shareBtn.style.top = `${Math.max(8, top) + scrollY}px`;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Older browsers: copy through a temporary textarea, then restore the selection.
      const sel = getSelection();
      const saved = sel.rangeCount ? sel.getRangeAt(0) : null;
      const ta = Object.assign(document.createElement('textarea'), { value: text });
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      if (saved) { sel.removeAllRanges(); sel.addRange(saved); }
      if (!ok) throw new Error('copy failed');
    }
  }

  document.addEventListener('selectionchange', () => {
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(updateShare, 200);
  });
  shareBtn.addEventListener('pointerdown', (e) => e.preventDefault()); // keep the selection
  shareBtn.addEventListener('click', async () => {
    try {
      if (coarse.matches && navigator.share) {
        await navigator.share({ url: shareUrl, text: `“${shareText}”` });
        track('quote-shared', 'Shared a quote link');
        shareBtn.hidden = true;
        return;
      }
      holdLabelUntil = Date.now() + 1300;
      await copyText(shareUrl);
      shareBtn.textContent = 'Link copied';
      track('quote-copied', 'Copied a quote link');
    } catch {
      shareBtn.textContent = 'Couldn’t copy';
    }
    setTimeout(() => { shareBtn.hidden = true; }, 1200);
  });

  // ---- Light / dark switch ----
  // The page follows the device setting until the reader picks a theme; the
  // pick is remembered. Switching grows a circle of the new theme from the
  // button where the browser supports view transitions, and crossfades
  // otherwise.

  const root = document.documentElement;
  const toggle = document.querySelector('.theme-toggle');
  const systemDark = matchMedia('(prefers-color-scheme: dark)');
  const isDark = () => (root.dataset.theme ? root.dataset.theme === 'dark' : systemDark.matches);
  function showTheme() {
    root.classList.toggle('theme-is-dark', isDark());
    toggle.setAttribute('aria-label', isDark() ? 'Switch to light mode' : 'Switch to dark mode');
  }
  showTheme();
  systemDark.addEventListener('change', showTheme);

  toggle.addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    const apply = () => {
      root.dataset.theme = next;
      try { localStorage.setItem('theme', next); } catch {}
      showTheme();
    };
    // Without view transitions, or with reduced motion: a short crossfade.
    if (!document.startViewTransition || reduceMotion.matches) {
      root.classList.add('theme-fading');
      apply();
      setTimeout(() => root.classList.remove('theme-fading'), 300);
      return;
    }
    const b = toggle.getBoundingClientRect();
    const x = b.left + b.width / 2;
    const y = b.top + b.height / 2;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    document.startViewTransition(apply).ready.then(() => {
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 650, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', pseudoElement: '::view-transition-new(root)' },
      );
    });
  });

  // ---- Print ----

  document.querySelector('.print-btn').addEventListener('click', () => print());
  addEventListener('beforeprint', () => track('print', 'Printed or saved as PDF'));
})();
