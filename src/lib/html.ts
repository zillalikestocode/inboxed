// HTML mail is shown in a sandboxed iframe (no scripts, forms or navigation) whose own Content-Security-Policy blocks
// every remote load until the reader asks for images. These build what goes in it.

/** Where common mail apps put quoted history: hidden until the reader shows it. */
export const QUOTE_SELECTOR = [
  'blockquote[type="cite"]',
  ".gmail_quote",
  ".yahoo_quoted",
  "#divRplyFwdMsg",
  "#divRplyFwdMsg ~ *",
  "#appendonsend",
  "#appendonsend ~ *",
  ".moz-cite-prefix",
  ".moz-cite-prefix ~ *",
].join(", ");

// Mail is designed for white paper: it gets a light page of its own.
const BASE = `:root { color-scheme: light; }
body { margin: 0; padding: 4px 0; display: flow-root; background: #fff; color: #1c1b1b; overflow-wrap: anywhere;
  font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-thumb { background: rgb(0 0 0 / 0.2); border-radius: 3px; }
::-webkit-scrollbar-track, ::-webkit-scrollbar-corner { background: transparent; }
img { max-width: 100%; height: auto; }
pre { white-space: pre-wrap; }
:root:not(.ib-show-quotes) :is(${QUOTE_SELECTOR}) { display: none !important; }`;

// Dark mail: the whole light page is inverted (hue kept by the rotation) and pictures are inverted back, so any design
// darkens without being understood. #ededed inverts to the app's dark canvas. The reader can switch back per message.
const DARK = `:root { filter: invert(1) hue-rotate(180deg); background: #ededed; }
body { background: #ededed; }
img, video, canvas, svg image, [background], [style*="background-image"], [style*="background: url"],
[style*="background:url"] { filter: invert(1) hue-rotate(180deg); }
:is([background], [style*="background"]) :is(img, video, canvas, svg image) { filter: none; }`;

// Mail that brings its own dark design gets to use it: the frame says dark instead of being inverted.
const NATIVE_DARK = `:root { color-scheme: dark; } body { background: #121212; color: #ededed; }
::-webkit-scrollbar-thumb { background: rgb(255 255 255 / 0.25); }`;
const OWN_DARK = /prefers-color-scheme\s*:\s*dark|color-scheme\s*:[^;"'}]*\bdark/i;

/** Whether the message has a dark design of its own (it is then shown that way rather than inverted). */
export const hasOwnDark = (html: string) => OWN_DARK.test(html);

// <meta> (refresh), <base> and <link> become unknown, inert elements: renaming the tag can't be dodged the way
// matching its attributes can. Embedded pages (frames, objects) go too: a page inside a message is a web page in the app. Links are kept once remote content is allowed (stylesheets then load); before that,
// WebKit would still preconnect to a <link>'s host despite the CSP, telling a tracker the mail was opened.
const INERT_ALWAYS = /<(\/?)(meta|base|i?frame|frameset|object|embed)\b/gi;
const INERT_LINK = /<(\/?)(link)\b/gi;
// Protocol-relative URLs would resolve against the app (tauri://…) inside srcdoc: give them https.
const PROTOCOL_RELATIVE = /(\b(?:src|href|srcset|poster|background)\s*=\s*["']?\s*|url\(\s*["']?\s*)\/\/(?=[\w.-])/gi;

/** Monospace in mail: code, Gmail's "Fixed width", and text styled in a fixed-width face. It keeps its font. */
export const MONOSPACE = /mono|courier|consolas|menlo/i;
const FIXED = ["pre", "code", "kbd", "samp", "tt", 'font[face*="mono" i]', 'font[face*="courier" i]', ...["mono", "courier", "consolas", "menlo"].map((f) => `[style*="${f}" i]`)];

/** The reader's mail font: every element in it, monospace aside, with the font's own @font-face rules. In a layer, so
 *  it beats the mail's own !important style sheets whatever their specificity (layered important wins over unlayered);
 *  HtmlBody removes inline font-family, which no layer can beat. */
const fontRules = (font: { family: string; css: string }) =>
  `${font.css}\n@layer ib-font { body, body :not(${FIXED.flatMap((f) => [f, `${f} *`]).join(", ")}) { font-family: ${font.family} !important; } }`;

/** The frame's document: the policy first, then the message. remote allows images, styles and fonts from the web;
 *  dark shows it dark: in its own dark design when it has one, else inverted; font sets every text in the reader's
 *  mail font (its files come from the app, so the policy allows the app's own origin for fonts). */
export function frameDoc(html: string, remote: boolean, dark = false, font?: { family: string; css: string }): string {
  const web = remote ? " https: http:" : "";
  const origin = globalThis.location?.origin;
  const app = font?.css ? ` 'self'${origin && origin !== "null" ? ` ${origin}` : ""}` : "";
  const policy =
    `default-src 'none'; script-src 'none'; style-src 'unsafe-inline'${web}; ` +
    `img-src data:${web}; font-src data:${app}${web}; media-src 'none'; base-uri 'none'; form-action 'none'`;
  let body = html.replace(INERT_ALWAYS, "<$1x-$2").replace(PROTOCOL_RELATIVE, "$1https://");
  if (!remote) body = body.replace(INERT_LINK, "<$1x-$2");
  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${policy}"><style>${BASE}${dark ? (hasOwnDark(html) ? NATIVE_DARK : DARK) : ""}${font ? fontRules(font) : ""}</style></head>` +
    `<body>${body}</body></html>`
  );
}

const REMOTE =
  /<img\b[^>]*\bsrc\s*=\s*["']?\s*(?:https?:)?\/\/|\bsrcset\s*=\s*["']?[^"'>]*(?:https?:)?\/\/|\b(?:background|poster)\s*=\s*["']?\s*(?:https?:)?\/\/|url\(\s*["']?\s*(?:https?:)?\/\/|<link\b[^>]*\bhref\s*=\s*["']?\s*(?:https?:)?\/\/|<image\b[^>]*\bhref\s*=\s*["']?\s*(?:https?:)?\/\/|@import\s+["']?\s*(?:url\()?\s*["']?(?:https?:)?\/\//i;

/** Whether the message wants anything from the web (images, backgrounds, styles): "Load images" is offered then. */
export const hasRemoteContent = (html: string) => REMOTE.test(html);

function decode(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** What a mailto: link asks for, as a draft: to (path or ?to=), cc, subject, body. */
export function mailtoDraft(href: string): { to: string; cc: string; subject: string; body: string } {
  const [path, query = ""] = href.replace(/^mailto:/i, "").split("?");
  const params = new Map<string, string>();
  for (const pair of query.split("&")) {
    const [k, v = ""] = pair.split("=");
    if (k) params.set(k.toLowerCase(), decode(v)); // "+" is a literal plus in mailto (RFC 6068)
  }
  return {
    to: [decode(path), params.get("to") ?? ""].filter(Boolean).join(", "),
    cc: params.get("cc") ?? "",
    subject: params.get("subject") ?? "",
    body: params.get("body") ?? "",
  };
}
