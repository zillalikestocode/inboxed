import { trailDate } from "./format";
import { TRAIL_RULE } from "./quote";
import type { Address, Message } from "./types";

// Compose writes HTML (the Tiptap editor in editor.ts). These turn text into the editor's HTML and the editor's HTML
// into what's sent. String work only: the editor's output is regular, and tests run without a DOM.

/** The fonts offered: ones recipients are likely to have, each with fallbacks. Default sets no font at all. */
export const FONTS = [
  { label: "Default", stack: "" },
  { label: "Arial", stack: "Arial, Helvetica, sans-serif" },
  { label: "Helvetica", stack: "Helvetica, Arial, sans-serif" },
  { label: "Verdana", stack: "Verdana, Geneva, sans-serif" },
  { label: "Georgia", stack: "Georgia, 'Times New Roman', serif" },
  { label: "Garamond", stack: "Garamond, 'Hoefler Text', Baskerville, Georgia, serif" },
  { label: "Times New Roman", stack: "'Times New Roman', Times, serif" },
  { label: "Courier New", stack: "'Courier New', Courier, monospace" },
];
export const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36];
export const BASE_SIZE = 11;
export const BASE_FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** What new mail is written in, unless the text says otherwise: Settings → Compose sets it. An empty font is BASE_FONT,
 *  an empty color the page's own (black). */
export type BaseStyle = { font: string; size: number; color: string };
export const DEFAULT_STYLE: BaseStyle = { font: "", size: BASE_SIZE, color: "" };
export const baseCss = (s: BaseStyle) =>
  `font-family: ${s.font || BASE_FONT}; font-size: ${s.size}pt${s.color ? `; color: ${s.color}` : ""}`;

// Swatches for white paper: mail is read on white.
export const COLORS = ["#000000", "#595959", "#c00000", "#e46c0a", "#bf8f00", "#00803c", "#007c80", "#0b5394", "#7030a0", "#c2185b"];
export const HIGHLIGHTS = ["#fff2a8", "#c9f2c7", "#cfe2ff", "#ffd6e7", "#ffe0b2", "#e5d4ff", "#e7e6e6"];

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** One paragraph per line, as the editor writes them. */
export const textToHtml = (text: string) => text.split("\n").map((line) => `<p>${escape(line)}</p>`).join("");

/** A reply's history, kept out of the editor and appended to what's written: the same in both versions of the draft. */
export type Trail = { html: string; text: string };

/** Where a reply's history starts in its HTML (Outlook's own marker, which the reader folds away). */
export const TRAIL_MARK = '<div id="appendonsend"></div>';

const attr = (s: string) => escape(s).replace(/"/g, "&quot;");
const link = (email: string) => `<a href="mailto:${attr(email)}">${escape(email)}</a>`;
const who = (a: Address) => (a.name && a.name !== a.email ? `${escape(a.name)} &lt;${link(a.email)}&gt;` : link(a.email));

/** An HTML message as it can go inside another: its body, without the page around it (its style sheets would restyle
 *  the whole reply), scripts, or pictures the reply can't carry: inline ones over ~75 KB (the reader inlines cid:
 *  pictures as data: URLs, which would bloat every reply) and cid: ones (their parts aren't sent along). */
function bodyOf(html: string): string {
  const body = /<body\b[^>]*>([\s\S]*)<\/body\s*>/i.exec(html)?.[1] ??
    html.replace(/<!doctype[^>]*>|<head\b[\s\S]*?<\/head>|<\/?(?:html|body)\b[^>]*>/gi, "");
  return body
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<img\b[^>]*\bsrc\s*=\s*["']?(?:data:[^"'\s>]{100000,}|cid:)[^>]*>/gi, "");
}

/** A reply's history as Outlook sends it: a rule over the answered message's headers (bold labels, in the base style),
 *  then the message as it was, HTML or text. Starts with TRAIL_MARK, so it can be found again in a saved draft. */
export function trailHtml(m: Message, base: BaseStyle, locale?: string): string {
  const rows: [string, string][] = [
    ["From", who(m.from)],
    ["Date", escape(trailDate(m.date, locale))],
    ["To", m.to.map(who).join("; ")],
    ...(m.cc.length ? [["Cc", m.cc.map(who).join("; ")] as [string, string]] : []),
    ["Subject", escape(m.subject)],
  ];
  const message = m.html
    ? bodyOf(m.html)
    : `<div style="${baseCss(base)}">${m.body.split("\n").map((l) => `<div>${l ? escape(l) : "<br>"}</div>`).join("")}</div>`;
  return (
    TRAIL_MARK +
    `<div id="divRplyFwdMsg" style="${baseCss(base)}; border-top: 1px solid #b5c4df; padding-top: 3pt; margin-top: 12pt">` +
    rows.map(([label, value]) => `<b>${label}:</b> ${value}`).join("<br>") +
    `</div><br><div>${message}</div>`
  );
}

/** A saved draft's trail (in its HTML and text), so a resumed reply keeps it out of the editor again; null for any other
 *  draft. The text starts with its blank line even when the saved body starts with the rule (the engine trims a stored
 *  body, so a reply with nothing written above its trail comes back that way). */
export function splitTrail(html: string, body: string): Trail | null {
  const i = html.indexOf(TRAIL_MARK);
  const j = body.search(new RegExp(`(?:^|\\n\\n)${TRAIL_RULE}\\nFrom:`));
  return i === -1 || j === -1 ? null : { html: html.slice(i), text: `\n\n${body.slice(j).replace(/^\n\n/, "")}` };
}

const WRAPPED = /^<div style="font-family: /; // the editor's own HTML starts with a paragraph or a list

/** What's sent: the base style around what was written, and paragraphs single-spaced as in the editor (mail apps space
 *  <p> apart, and show an empty one as nothing). Mentions are links already. A reply's trail follows as it is. */
export function emailHtml(html: string, base = DEFAULT_STYLE): string {
  const trail = html.indexOf(TRAIL_MARK);
  if (trail !== -1) return emailHtml(html.slice(0, trail), base) + html.slice(trail);
  if (WRAPPED.test(html)) return html;
  const spaced = html
    .replace(/<p( style="([^"]*)")?>/g, (_, __, style) => `<p style="margin: 0${style ? `; ${style}` : ""}">`)
    .replace(/(<p [^>]*>)(<\/p>)/g, "$1<br>$2");
  return `<div style="${baseCss(base)}">${spaced}</div>`;
}

const signatureHtml = (sig: string) => `<p></p>${textToHtml(`-- \n${sig}`)}`;

/** swapSignature for the editor's HTML: the old account's signature becomes the new one's (or goes, or is added at
 *  the end of what's written, above tail, a folded quote). An edited signature is left alone. */
export function swapSignatureHtml(html: string, from: string, to: string, tail = ""): string {
  const next = to.trim() ? signatureHtml(to.trim()) : "";
  const old = from.trim() && signatureHtml(from.trim());
  if (old && html.includes(old)) return html.replace(old, next);
  if (old || !next) return html;
  const head = tail && html.endsWith(tail) ? html.slice(0, -tail.length) : html;
  return head + next + (head === html ? "" : tail);
}

type Node = { type: string; text?: string; attrs?: Record<string, unknown>; content?: Node[] };

/** The plain-text version of the editor's document (editor.getJSON()), as mail apps without HTML show it: one line per
 *  paragraph, quoted lines marked "> " (a reply's history must not read as the sender's words), list items dashed or
 *  numbered, mentions as @Name. */
export function plainText(doc: Node): string {
  const inline = (n: Node): string =>
    n.type === "text" ? (n.text ?? "") : n.type === "hardBreak" ? "\n" : n.type === "mention" ? `@${n.attrs?.label ?? ""}` : (n.content ?? []).map(inline).join("");
  const blocks = (nodes: Node[] = []): string[] =>
    nodes.flatMap((n) => {
      if (n.type === "blockquote") return blocks(n.content).map((line) => `> ${line}`.trimEnd());
      if (n.type === "bulletList" || n.type === "orderedList") {
        return (n.content ?? []).flatMap((item, i) => {
          const [first = "", ...rest] = blocks(item.content);
          return [`${n.type === "bulletList" ? "-" : `${i + 1}.`} ${first}`, ...rest.map((l) => `   ${l}`)];
        });
      }
      return n.type === "paragraph" ? inline(n).split("\n") : blocks(n.content);
    });
  return blocks(doc.content).join("\n");
}
