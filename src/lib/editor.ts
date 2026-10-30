import { Editor, Extension } from "@tiptap/core";
import Mention from "@tiptap/extension-mention";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyleKit } from "@tiptap/extension-text-style";
import StarterKit from "@tiptap/starter-kit";
import { plainText } from "./rich";
import type { Contact } from "./types";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    indent: { indent: () => ReturnType; outdent: () => ReturnType };
  }
}

const MAX_INDENT = 8;

// Paragraph indent as a left margin (what mail apps keep); in a list it nests or un-nests the item instead.
const Indent = Extension.create({
  name: "indent",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph"],
        attributes: {
          indent: {
            default: 0,
            parseHTML: (el) => Math.min(MAX_INDENT, Math.round(parseFloat(el.style.marginLeft) / 2) || 0),
            renderHTML: (attrs) => (attrs.indent ? { style: `margin-left: ${attrs.indent * 2}em` } : {}),
          },
        },
      },
    ];
  },
  addCommands() {
    const shift =
      (by: number) =>
      ({ state, tr, dispatch }: { state: Editor["state"]; tr: Editor["state"]["tr"]; dispatch?: (tr: Editor["state"]["tr"]) => void }) => {
        const { from, to } = state.selection;
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (node.type.name !== "paragraph") return;
          const indent = Math.max(0, Math.min(MAX_INDENT, (node.attrs.indent ?? 0) + by));
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent });
        });
        dispatch?.(tr);
        return true;
      };
    return {
      indent:
        () =>
        ({ editor, commands, ...rest }) =>
          editor.isActive("listItem") ? commands.sinkListItem("listItem") : shift(1)(rest),
      outdent:
        () =>
        ({ editor, commands, ...rest }) =>
          editor.isActive("listItem") ? commands.liftListItem("listItem") : shift(-1)(rest),
    };
  },
});

// ⌘Enter sends (Compose's window handler); without this the editor would also insert a line break first.
const SendKey = Extension.create({
  name: "sendKey",
  priority: 1000,
  addKeyboardShortcuts: () => ({ "Mod-Enter": () => true }),
});

/** What compose shows for an @mention being typed: the people it could be, which is highlighted, where the caret is,
 *  and how to pick one. null hides it. */
export type MentionState = { items: Contact[]; active: number; rect: DOMRect | null; pick: (c: Contact) => void };
export type MentionHooks = {
  items: (query: string) => Contact[];
  show: (state: MentionState | null) => void;
  picked: (c: Contact) => void; // they're added to To if they aren't on the message yet
};

// A mention is a mailto link in what's sent, so it works anywhere; here it's an atom that Backspace removes whole.
function mentions(hooks: MentionHooks) {
  return Mention.extend({
    parseHTML: () => [{ tag: 'a[data-type="mention"]', priority: 60 }, { tag: 'span[data-type="mention"]' }],
  }).configure({
    deleteTriggerWithBackspace: true,
    renderHTML: ({ node }) => [
      "a",
      { href: `mailto:${node.attrs.id}`, "data-type": "mention", "data-id": node.attrs.id, "data-label": node.attrs.label },
      `@${node.attrs.label}`,
    ],
    renderText: ({ node }) => `@${node.attrs.label}`,
    suggestion: {
      char: "@",
      allowSpaces: true, // "@Ada Lo…" finds Ada Lovelace
      items: ({ query }) => hooks.items(query),
      render: () => {
        let items: Contact[] = [];
        let active = 0;
        let rect: DOMRect | null = null;
        let command: (attrs: { id: string; label: string }) => void = () => {};
        const pick = (c: Contact) => {
          command({ id: c.email, label: c.name || c.email });
          hooks.picked(c);
        };
        const show = () => hooks.show(items.length ? { items, active, rect, pick } : null);
        const update = (props: { items: Contact[]; clientRect?: (() => DOMRect | null) | null; command: typeof command }) => {
          items = props.items;
          active = Math.min(active, Math.max(items.length - 1, 0));
          rect = props.clientRect?.() ?? null;
          command = props.command;
          show();
        };
        return {
          onStart: update,
          onUpdate: update,
          onKeyDown: ({ event }) => {
            if (!items.length || event.metaKey || event.ctrlKey || event.altKey) return false; // ⌘Enter sends
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              active = (active + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
              show();
            } else if (event.key === "Enter" || event.key === "Tab") pick(items[active]);
            else if (event.key === "Escape") {
              items = [];
              show();
            } else return false;
            return true;
          },
          onExit: () => hooks.show(null),
        };
      },
    },
  });
}

/** The compose editor in el, starting with html. onChange gets its HTML and plain-text version after every edit. style
 *  is the page's own (the base style new mail is sent in). */
export function createEditor(
  el: HTMLElement,
  opts: { html: string; onChange: (html: string, text: string) => void; mention?: MentionHooks; style?: string },
): Editor {
  return new Editor({
    element: el,
    content: opts.html,
    parseOptions: { preserveWhitespace: true }, // keeps the "-- " that starts a signature
    extensions: [
      StarterKit.configure({
        heading: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
        link: { openOnClick: false, autolink: true, defaultProtocol: "https", protocols: ["mailto"] },
      }),
      TextStyleKit.configure({ lineHeight: false }),
      TextAlign.configure({ types: ["paragraph"] }),
      Indent,
      SendKey,
      ...(opts.mention ? [mentions(opts.mention)] : []),
    ],
    editorProps: {
      attributes: { "aria-label": "Message", "aria-multiline": "true", role: "textbox", class: "compose-page", style: opts.style ?? "" },
    },
    onUpdate: ({ editor }) => opts.onChange(editor.getHTML(), plainText(editor.getJSON())),
  });
}
