// The page side of the continuous scroll reader (ScrollReaderController.swift): every chapter of the
// book in one page, in reading order, each in a <section data-index>. It reports where the reader is,
// goes to a spot, draws highlights and notes, and reads the current selection.

const stacks = (() => {
  const post = (name, body) => window.webkit.messageHandlers[name].postMessage(body);
  let sections = [];
  let drawn = []; // { id, range }

  // MARK: loading

  async function load(chapters) {
    const book = document.getElementById("book");
    const theme = document.getElementById("stacks-theme");
    const seenStyles = new Set();
    const texts = await Promise.all(chapters.map((c) => fetch(c.url).then((r) => r.text()).catch(() => "")));
    chapters.forEach((chapter, index) => {
      const doc = new DOMParser().parseFromString(texts[index], "text/html");
      for (const el of doc.querySelectorAll('link[rel~="stylesheet"], style')) {
        const isLink = el.tagName === "LINK";
        const key = isLink ? new URL(el.getAttribute("href"), chapter.url).href : el.textContent;
        if (seenStyles.has(key)) continue;
        seenStyles.add(key);
        const copy = document.createElement(isLink ? "link" : "style");
        if (isLink) { copy.rel = "stylesheet"; copy.href = key; } else { copy.textContent = el.textContent; }
        document.head.insertBefore(copy, theme); // the book's styles first, so Stacks' theme wins
      }
      const section = document.createElement("section");
      section.className = "stacks-chapter " + (doc.body.className || "");
      section.dataset.index = index;
      section.dataset.url = chapter.url;
      resolveURLs(doc.body, chapter.url);
      section.append(...doc.body.childNodes);
      book.append(section);
    });
    sections = [...book.querySelectorAll(":scope > section")];
    book.addEventListener("click", onTap);
  }

  // Each chapter's relative links and images are relative to its own file, not to this page.
  function resolveURLs(root, base) {
    for (const el of root.querySelectorAll("[src], [href], [poster]")) {
      for (const attr of ["src", "href", "poster"]) {
        const value = el.getAttribute(attr);
        if (value && !value.startsWith("#")) el.setAttribute(attr, new URL(value, base).href);
        else if (value) el.setAttribute(attr, base + value);
      }
    }
    for (const el of root.querySelectorAll("image, use")) {
      const value = el.getAttribute("xlink:href") || el.getAttributeNS("http://www.w3.org/1999/xlink", "href");
      if (value) el.setAttributeNS("http://www.w3.org/1999/xlink", "href", new URL(value, base).href);
    }
  }

  // MARK: where the reader is

  function current() {
    if (!sections.length) return null;
    if (scrollY + innerHeight >= document.documentElement.scrollHeight - 2) {
      return { index: sections.length - 1, progression: 1 };
    }
    for (const section of sections) {
      const r = section.getBoundingClientRect();
      if (r.bottom > 1) {
        return { index: +section.dataset.index, progression: r.height > 0 ? clamp(-r.top / r.height) : 0 };
      }
    }
    return { index: sections.length - 1, progression: 1 };
  }

  const clamp = (x) => Math.min(1, Math.max(0, x));
  let reportTimer;
  function report() { const c = current(); if (c) post("location", c); }
  addEventListener("scroll", () => { clearTimeout(reportTimer); reportTimer = setTimeout(report, 150); }, { passive: true });

  function go(index, progression, fragment) {
    const section = sections[index];
    if (!section) return false;
    let top;
    if (fragment) {
      const el = section.querySelector("#" + CSS.escape(fragment)) || section.querySelector(`[name="${CSS.escape(fragment)}"]`);
      if (el) top = el.getBoundingClientRect().top + scrollY;
    }
    if (top === undefined) {
      const r = section.getBoundingClientRect();
      top = r.top + scrollY + (progression || 0) * r.height;
    }
    scrollTo(0, Math.max(0, top));
    report();
    return true;
  }

  // A highlight or note: go to its text (Apple Books' imported ones say only what they highlight).
  function goToText(index, before, highlight, after) {
    const section = sections[index];
    const range = section && findRange(section, before, highlight, after);
    if (!range) return false;
    scrollTo(0, Math.max(0, range.getBoundingClientRect().top + scrollY - innerHeight / 3));
    report();
    return true;
  }

  // Settings change the layout; keep the reader on the same spot.
  function setTheme(css) {
    const here = current();
    document.getElementById("stacks-theme").textContent = css;
    if (here) requestAnimationFrame(() => go(here.index, here.progression));
  }

  // MARK: highlights and notes

  // The section's text with runs of whitespace collapsed to one space, and where each character came from,
  // so a quote saved on another device (or by Readium) is found even if spacing differs.
  function flatten(section) {
    const walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT);
    let text = "";
    const map = [];
    let node;
    while ((node = walker.nextNode())) {
      for (let i = 0; i < node.data.length; i++) {
        const isSpace = /\s/.test(node.data[i]);
        if (isSpace && text.endsWith(" ")) continue;
        text += isSpace ? " " : node.data[i];
        map.push([node, i]);
      }
    }
    return { text, map };
  }

  const squash = (s) => (s || "").replace(/\s+/g, " ");

  function findRange(section, before, highlight, after) {
    const { text, map } = flatten(section);
    const h = squash(highlight).trim();
    if (!h) return null;
    const b = squash(before).slice(-32);
    const a = squash(after).slice(0, 32);
    let start = -1;
    for (const [pre, post] of [[b, a], [b, ""], ["", a], ["", ""]]) {
      const at = text.indexOf(pre.trimStart() + h + post.trimEnd());
      if (at >= 0) { start = at + pre.trimStart().length; break; }
      const loose = text.indexOf(pre.trim() + " " + h);
      if (pre.trim() && loose >= 0) { start = loose + pre.trim().length + 1; break; }
    }
    if (start < 0 || start + h.length > map.length) return null;
    const [startNode, startOffset] = map[start];
    const [endNode, endOffset] = map[start + h.length - 1];
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset + 1);
    return range;
  }

  // items: [{ id, index, highlight, before, after, color, kind }]
  function showAnnotations(items) {
    drawn = [];
    if (!window.CSS || !CSS.highlights) return 0;
    CSS.highlights.clear();
    const groups = {};
    let css = "";
    for (const item of items) {
      const section = sections[item.index];
      const range = section && findRange(section, item.before, item.highlight, item.after);
      if (!range) continue;
      drawn.push({ id: item.id, range });
      const name = `stacks-${item.kind}-${item.color.replace("#", "")}`;
      if (!groups[name]) {
        groups[name] = new Highlight();
        CSS.highlights.set(name, groups[name]);
        css += item.kind === "note"
          ? `::highlight(${name}) { text-decoration: underline 2px ${item.color}; }\n`
          : `::highlight(${name}) { background-color: ${item.color}55; }\n`;
      }
      groups[name].add(range);
    }
    document.getElementById("stacks-highlights").textContent = css;
    return drawn.length;
  }

  function selection() {
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    const start = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    const section = start && start.closest("section.stacks-chapter");
    if (!section) return null;
    const pre = document.createRange();
    pre.setStart(section, 0);
    pre.setEnd(range.startContainer, range.startOffset);
    const post = document.createRange();
    post.setStart(range.endContainer, range.endOffset);
    post.setEnd(section, section.childNodes.length);
    const box = section.getBoundingClientRect();
    const at = range.getBoundingClientRect();
    return {
      index: +section.dataset.index,
      highlight: sel.toString(),
      before: pre.toString().slice(-100),
      after: post.toString().slice(0, 100),
      progression: box.height > 0 ? clamp((at.top - box.top) / box.height) : 0,
    };
  }

  function clearSelection() { getSelection().removeAllRanges(); }

  // MARK: taps and links

  // iOS only sends taps to elements that listen for them themselves, so this is on the book, not the window.
  function onTap(event) {
    const link = event.target.closest && event.target.closest("a[href]");
    if (link) {
      event.preventDefault();
      const url = new URL(link.href);
      const fragment = url.hash ? decodeURIComponent(url.hash.slice(1)) : null;
      url.hash = "";
      const target = sections.find((s) => s.dataset.url === url.href);
      if (target) go(+target.dataset.index, 0, fragment);
      else if (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:") post("external", link.href);
      return;
    }
    if (!getSelection().isCollapsed) return;
    const caret = document.caretRangeFromPoint(event.clientX, event.clientY);
    if (caret) {
      const hit = drawn.find((d) => d.range.isPointInRange(caret.startContainer, caret.startOffset));
      if (hit) { post("annotationTapped", hit.id); return; }
    }
    post("tap", null);
  }

  return { load, go, goToText, current, setTheme, showAnnotations, selection, clearSelection };
})();
