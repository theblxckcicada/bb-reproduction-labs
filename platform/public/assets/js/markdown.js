// Minimal, XSS-safe markdown renderer.
//
// Everything is HTML-escaped first; only a fixed set of tags is introduced and
// links are restricted to http(s). Supports headings, bold/italic, inline and
// fenced code, blockquotes, ordered/unordered lists, and paragraphs — enough
// for lab briefs and write-ups without pulling in a dependency.

import { escapeHtml } from "./util.js";

/**
 * Apply inline formatting to an already-escaped run of text.
 * @param {string} text Raw (unescaped) text.
 * @returns {string} Safe HTML.
 */
function inline(text) {
  let s = escapeHtml(text);
  s = s.replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`);
  s = s.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_m, label, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`
  );
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  s = s.replace(/(^|[^_])_([^_\n]+)_/g, "$1<em>$2</em>");
  return s;
}

/**
 * Render a markdown string to safe HTML.
 * @param {string} src
 * @returns {string}
 */
export function renderMarkdown(src) {
  if (!src) {
    return "";
  }

  const lines = String(src).replace(/\r\n/g, "\n").split("\n");
  const out = [];

  let para = [];
  let listType = null;
  let listItems = [];
  let quote = [];
  let inCode = false;
  let code = [];

  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${inline(para.join(" "))}</p>`);
      para = [];
    }
  };
  const flushList = () => {
    if (listType) {
      out.push(
        `<${listType}>${listItems.map((li) => `<li>${inline(li)}</li>`).join("")}</${listType}>`
      );
      listType = null;
      listItems = [];
    }
  };
  const flushQuote = () => {
    if (quote.length) {
      out.push(`<blockquote>${inline(quote.join(" "))}</blockquote>`);
      quote = [];
    }
  };
  const flushAll = () => {
    flushPara();
    flushList();
    flushQuote();
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      if (!inCode) {
        flushAll();
        inCode = true;
        code = [];
      } else {
        out.push(`<pre><code>${code.map(escapeHtml).join("\n")}</code></pre>`);
        inCode = false;
      }
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }

    if (trimmed === "") {
      flushAll();
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      const level = Math.min(heading[1].length, 3);
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    if (/^>\s?/.test(line)) {
      flushPara();
      flushList();
      quote.push(line.replace(/^>\s?/, ""));
      continue;
    }
    flushQuote();

    const ul = /^[-*+]\s+(.*)$/.exec(line);
    if (ul) {
      flushPara();
      if (listType && listType !== "ul") {
        flushList();
      }
      listType = "ul";
      listItems.push(ul[1]);
      continue;
    }

    const ol = /^\d+\.\s+(.*)$/.exec(line);
    if (ol) {
      flushPara();
      if (listType && listType !== "ol") {
        flushList();
      }
      listType = "ol";
      listItems.push(ol[1]);
      continue;
    }

    flushList();
    para.push(trimmed);
  }

  if (inCode) {
    out.push(`<pre><code>${code.map(escapeHtml).join("\n")}</code></pre>`);
  }
  flushAll();
  return out.join("\n");
}
