<script lang="ts">
  import type { Editor } from "@tiptap/core";
  import {
    ArrowDown01Icon,
    HighlighterIcon,
    MoreHorizontalIcon,
    TextBoldIcon,
    TextColorIcon,
    TextItalicIcon,
    TextUnderlineIcon,
    Undo02Icon,
  } from "@hugeicons/core-free-icons";
  import { menuAt } from "$lib/contextmenu";
  import type { MenuEntry } from "$lib/menus";
  import { COLORS, FONTS, HIGHLIGHTS, SIZES } from "$lib/rich";
  import { composeStyle } from "$lib/settings.svelte";
  import Icon from "./Icon.svelte";
  import Palette from "./Palette.svelte";

  // Outlook's row: undo, font, size, color, highlight, bold/italic/underline, then ••• for the rest (a native menu).
  let { editor }: { editor: Editor } = $props();

  const isMac = navigator.platform.startsWith("Mac");
  const key = (k: string) => (isMac ? `⌘${k}` : `Ctrl+${k}`);

  // The buttons show the text at the caret: re-read after every change to the document or the selection.
  let tick = $state(0);
  $effect(() => {
    const bump = () => tick++;
    editor.on("transaction", bump);
    return () => editor.off("transaction", bump);
  });
  const read = <T,>(f: () => T): T => {
    void tick;
    return f();
  };
  const style = $derived(read(() => editor.getAttributes("textStyle")));
  const active = (name: string) => read(() => editor.isActive(name));
  // Text without a font or size of its own is in the base style (Settings → Compose); "Default" is that font.
  const base = composeStyle();
  const font = $derived(FONTS.find((f) => f.stack && f.stack === style.fontFamily)?.stack ?? "");
  const size = $derived(parseInt(style.fontSize) || base.size);
  const color: string | null = $derived(style.color ?? null);
  const highlight: string | null = $derived(style.backgroundColor ?? null);

  let palette = $state<"" | "color" | "highlight">("");
  let linking = $state(false);
  let url = $state("");
  let linkInput = $state<HTMLInputElement>();

  const chain = () => editor.chain().focus();

  export function openLink() {
    url = editor.getAttributes("link").href ?? "";
    linking = true;
    queueMicrotask(() => linkInput?.select());
  }
  function applyLink() {
    const href = url.trim();
    if (!href) chain().extendMarkRange("link").unsetLink().run();
    else chain().extendMarkRange("link").setLink({ href: /^[a-z][\w+.-]*:/i.test(href) ? href : /@/.test(href) ? `mailto:${href}` : `https://${href}` }).run();
    linking = false;
  }

  function more(el: HTMLElement) {
    const entries: MenuEntry[] = [
      { text: "Strikethrough", accelerator: "CmdOrCtrl+Shift+S", action: () => chain().toggleStrike().run() },
      "separator",
      { text: "Bulleted List", accelerator: "CmdOrCtrl+Shift+8", action: () => chain().toggleBulletList().run() },
      { text: "Numbered List", accelerator: "CmdOrCtrl+Shift+7", action: () => chain().toggleOrderedList().run() },
      "separator",
      { text: "Align Left", accelerator: "CmdOrCtrl+Shift+L", action: () => chain().setTextAlign("left").run() },
      { text: "Align Center", accelerator: "CmdOrCtrl+Shift+E", action: () => chain().setTextAlign("center").run() },
      { text: "Align Right", accelerator: "CmdOrCtrl+Shift+R", action: () => chain().setTextAlign("right").run() },
      "separator",
      { text: "Increase Indent", accelerator: "CmdOrCtrl+]", action: () => chain().indent().run() },
      { text: "Decrease Indent", accelerator: "CmdOrCtrl+[", action: () => chain().outdent().run() },
      "separator",
      { text: "Link…", accelerator: "CmdOrCtrl+K", action: openLink },
      { text: "Clear Formatting", action: () => chain().unsetAllMarks().unsetTextAlign().run() },
    ];
    menuAt(el, entries);
  }

  // Shortcuts beyond the editor's own (⌘B/I/U, ⌘Z, ⇧⌘Z, lists, alignment come with it).
  function keydown(e: KeyboardEvent) {
    if (!(isMac ? e.metaKey : e.ctrlKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === "k" && !e.shiftKey) openLink();
    else if (k === "]") chain().indent().run();
    else if (k === "[") chain().outdent().run();
    else return;
    e.preventDefault();
  }
  $effect(() => {
    const dom = editor.view.dom;
    dom.addEventListener("keydown", keydown);
    return () => dom.removeEventListener("keydown", keydown);
  });
</script>

{#snippet toggle(name: string, label: string, shortcut: string, icon: typeof TextBoldIcon, run: () => void)}
  <button type="button" class="icon-btn aria-pressed:bg-ink/10 aria-pressed:text-ink" aria-label={label} title="{label} ({shortcut})" aria-pressed={active(name)} onclick={run}>
    <Icon {icon} size={16} />
  </button>
{/snippet}

<div role="toolbar" aria-label="Formatting" class="flex h-10 shrink-0 items-center gap-0.5 border-b border-line px-2">
  {#if linking}
    <span class="pl-2 text-ink-muted">Link</span>
    <input
      bind:this={linkInput}
      bind:value={url}
      placeholder="https://… or an email address"
      aria-label="Link address"
      spellcheck="false"
      class="h-8 min-w-0 flex-1 bg-transparent px-2 outline-none"
      onkeydown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          applyLink();
        } else if (e.key === "Escape") {
          e.preventDefault();
          linking = false;
          editor.commands.focus();
        }
      }}
      onblur={() => (linking = false)}
    />
    <span class="pr-2 text-caption text-ink-muted">Enter to apply · empty removes it</span>
  {:else}
    <button type="button" class="icon-btn" aria-label="Undo" title="Undo ({key('Z')})" disabled={read(() => !editor.can().undo())} onclick={() => chain().undo().run()}>
      <Icon icon={Undo02Icon} size={16} />
    </button>
    <button
      type="button"
      class="icon-btn w-5!"
      aria-label="More undo options"
      title="Redo ({isMac ? '⇧⌘Z' : 'Ctrl+Y'})"
      onclick={(e) => menuAt(e.currentTarget, [{ text: "Redo", accelerator: "CmdOrCtrl+Shift+Z", enabled: editor.can().redo(), action: () => chain().redo().run() }])}
    >
      <Icon icon={ArrowDown01Icon} size={12} />
    </button>
    <div class="mx-1.5 h-5 border-l border-line"></div>

    <select
      class="h-8 w-32 truncate rounded-lg bg-raised px-2 outline-none hover:bg-ink/5 focus-visible:ring-2 focus-visible:ring-accent"
      aria-label="Font"
      value={font}
      onchange={(e) => (e.currentTarget.value ? chain().setFontFamily(e.currentTarget.value).run() : chain().unsetFontFamily().run())}
    >
      {#each FONTS as f (f.label)}
        <option value={f.stack}>{f.stack || !base.font ? f.label : `Default (${FONTS.find((x) => x.stack === base.font)?.label})`}</option>
      {/each}
    </select>
    <select
      class="ml-1 h-8 w-14 rounded-lg bg-raised px-2 tabular-nums outline-none hover:bg-ink/5 focus-visible:ring-2 focus-visible:ring-accent"
      aria-label="Size"
      value={size}
      onchange={(e) => {
        const n = Number(e.currentTarget.value);
        if (n === base.size) chain().unsetFontSize().run();
        else chain().setFontSize(`${n}pt`).run();
      }}
    >
      {#each SIZES as s (s)}<option value={s}>{s}</option>{/each}
    </select>

    <div class="relative ml-1 flex">
      <button type="button" class="icon-btn relative" aria-label="Text color" title="Text color" onclick={() => (palette = palette === "color" ? "" : "color")}>
        <Icon icon={TextColorIcon} size={16} />
        <span class="absolute right-2 bottom-1 left-2 h-[3px] rounded-full" style:background-color={color ?? "currentColor"}></span>
      </button>
      {#if palette === "color"}
        <Palette
          label="Text color"
          colors={COLORS}
          none="Automatic"
          current={color}
          onpick={(c) => {
            if (c) chain().setColor(c).run();
            else chain().unsetColor().run();
            palette = "";
          }}
          onclose={() => (palette = "")}
        />
      {/if}
    </div>
    <div class="relative flex">
      <button type="button" class="icon-btn relative" aria-label="Highlight" title="Highlight" onclick={() => (palette = palette === "highlight" ? "" : "highlight")}>
        <Icon icon={HighlighterIcon} size={16} />
        {#if highlight}<span class="absolute right-2 bottom-1 left-2 h-[3px] rounded-full" style:background-color={highlight}></span>{/if}
      </button>
      {#if palette === "highlight"}
        <Palette
          label="Highlight"
          colors={HIGHLIGHTS}
          none="No highlight"
          current={highlight}
          onpick={(c) => {
            if (c) chain().setBackgroundColor(c).run();
            else chain().unsetBackgroundColor().run();
            palette = "";
          }}
          onclose={() => (palette = "")}
        />
      {/if}
    </div>

    {@render toggle("bold", "Bold", key("B"), TextBoldIcon, () => chain().toggleBold().run())}
    {@render toggle("italic", "Italic", key("I"), TextItalicIcon, () => chain().toggleItalic().run())}
    {@render toggle("underline", "Underline", key("U"), TextUnderlineIcon, () => chain().toggleUnderline().run())}
    <button type="button" class="icon-btn" aria-label="More formatting" title="More formatting" onclick={(e) => more(e.currentTarget)}>
      <Icon icon={MoreHorizontalIcon} size={16} />
    </button>
  {/if}
</div>
