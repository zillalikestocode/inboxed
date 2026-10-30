// What the person sets in Settings, remembered in localStorage (it's about this computer's reading, not the mail).
import inter from "@fontsource-variable/inter/wght.css?inline";
import interItalic from "@fontsource-variable/inter/wght-italic.css?inline";
import geist from "@fontsource-variable/geist/wght.css?inline";
import geistItalic from "@fontsource-variable/geist/wght-italic.css?inline";
import plex from "@fontsource-variable/ibm-plex-sans/wght.css?inline";
import plexItalic from "@fontsource-variable/ibm-plex-sans/wght-italic.css?inline";
import literata from "@fontsource-variable/literata/wght.css?inline";
import literataItalic from "@fontsource-variable/literata/wght-italic.css?inline";
import garamond from "@fontsource-variable/eb-garamond/wght.css?inline";
import garamondItalic from "@fontsource-variable/eb-garamond/wght-italic.css?inline";
import sourceSerif from "@fontsource-variable/source-serif-4/wght.css?inline";
import sourceSerifItalic from "@fontsource-variable/source-serif-4/wght-italic.css?inline";
import { BASE_SIZE, COLORS, FONTS as COMPOSE_FONTS, SIZES, type BaseStyle } from "./rich";

export type MailFont = { id: string; name: string; family: string; css: string };

const SANS = `system-ui, -apple-system, "Segoe UI", sans-serif`;
const SERIF = `Georgia, "Times New Roman", serif`;

/** The fonts mail can be read in. css is the font's @font-face rules (bundled files, every subset, both styles), so
 *  the mail frame can load it too. */
export const FONTS: MailFont[] = [
  { id: "inter", name: "Inter", family: `"Inter Variable", ${SANS}`, css: inter + interItalic },
  { id: "geist", name: "Geist", family: `"Geist Variable", ${SANS}`, css: geist + geistItalic },
  { id: "plex", name: "IBM Plex Sans", family: `"IBM Plex Sans Variable", ${SANS}`, css: plex + plexItalic },
  { id: "literata", name: "Literata", family: `"Literata Variable", ${SERIF}`, css: literata + literataItalic },
  { id: "garamond", name: "EB Garamond", family: `"EB Garamond Variable", ${SERIF}`, css: garamond + garamondItalic },
  { id: "source-serif", name: "Source Serif", family: `"Source Serif 4 Variable", ${SERIF}`, css: sourceSerif + sourceSerifItalic },
  { id: "system", name: "System", family: `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`, css: "" },
];

const KEY = "inboxed.settings";

const DEFAULTS = {
  mailFont: "inter",
  markRead: true, // opening a conversation marks it read
  loadImages: false, // remote images load without asking (the sender can then see the mail was opened)
  notify: true, // a desktop notification for each new message while Inboxed isn't in front
  notifyDomains: "", // only mail from these sender domains notifies (any space, comma or line between); empty: all
  sound: true,
  dockBadge: true, // the inboxes' unread count on the Dock icon
  signatures: {} as Record<string, string>, // by account id
  // What new mail is written in (rich.ts's BaseStyle): a font stack from rich.ts ("" = the default), a size in points,
  // a swatch ("" = automatic).
  composeFont: "",
  composeSize: BASE_SIZE,
  composeColor: "",
  sidebarHidden: false, // the rail and the list folded away, leaving the mail
};

// Stored values only count when they're of the right kind: anything else is the default.
function load(): typeof DEFAULTS {
  const out = structuredClone(DEFAULTS);
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    for (const k of Object.keys(DEFAULTS) as (keyof typeof DEFAULTS)[]) {
      if (saved?.[k] !== null && typeof saved?.[k] === typeof DEFAULTS[k]) (out as Record<string, unknown>)[k] = saved[k];
    }
  } catch {
    // Unreadable: the defaults.
  }
  if (!FONTS.some((f) => f.id === out.mailFont)) out.mailFont = DEFAULTS.mailFont;
  // These go into style attributes: only what's offered.
  if (!COMPOSE_FONTS.some((f) => f.stack === out.composeFont)) out.composeFont = DEFAULTS.composeFont;
  if (!SIZES.includes(out.composeSize)) out.composeSize = DEFAULTS.composeSize;
  if (out.composeColor && !COLORS.includes(out.composeColor)) out.composeColor = DEFAULTS.composeColor;
  return out;
}

export const settings = $state(load());

/** Remembers the settings as they are now. Settings.svelte calls it after every change. */
export function saveSettings() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Not remembered; the change still holds for this session.
  }
}

/** What new mail is written in. */
export const composeStyle = (): BaseStyle => ({ font: settings.composeFont, size: settings.composeSize, color: settings.composeColor });

export const mailFont = () => FONTS.find((f) => f.id === settings.mailFont) ?? FONTS[0];

/** The page itself needs the faces too: plain-text mail, and Settings shows each name in its own font. Files load only
 *  when text uses them. Called once, at startup. */
export function loadFonts() {
  const style = document.createElement("style");
  style.textContent = FONTS.map((f) => f.css).join("\n");
  document.head.append(style);
}
