<script lang="ts">
  import { MoreHorizontalIcon } from "@hugeicons/core-free-icons";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import Icon from "./Icon.svelte";
  import { frameDoc, hasOwnDark, hasRemoteContent, mailtoDraft, MONOSPACE, QUOTE_SELECTOR } from "$lib/html";
  import { compose } from "$lib/state.svelte";
  import { mailFont, settings } from "$lib/settings.svelte";
  import { theme } from "$lib/theme.svelte";

  // paper: shown as it'll be sent, on compose's white page (which the dark theme inverts itself): light, in its own
  // fonts, quotes and all, with nothing to change about it.
  let { html, accountId, paper = false }: { html: string; accountId: string; paper?: boolean } = $props();

  let frame = $state<HTMLIFrameElement>();
  let remote = $state(settings.loadImages); // per message, per visit: images load only when asked (or always, in Settings)
  let original = $state(false); // per message, per visit: shown light although the app is dark
  let height = $state(0);
  let hasQuotes = $state(false);
  let showQuotes = $state(false); // paper shows them all (loaded)
  // Mail with a dark design of its own follows the window's appearance by itself: there's no original to go back to.
  const ownDark = $derived(hasOwnDark(html));
  const dark = $derived(!paper && theme.current === "dark" && (ownDark || !original));
  const doc = $derived(frameDoc(html, remote, dark, paper ? undefined : mailFont()));
  const blocked = $derived(hasRemoteContent(html) && !remote);
  const recolorable = $derived(!paper && theme.current === "dark" && !ownDark);
  let observer: ResizeObserver | undefined;
  let steps = 0;
  const MAX_HEIGHT = 30_000;

  // The frame runs no scripts, so it can't size itself: the page measures its content. Content sized by the
  // viewport (100vh) grows with the frame; a frame that keeps growing by the same step is that loop, and stops.
  function measure() {
    const body = frame?.contentDocument?.body;
    if (!body) return;
    const next = Math.min(MAX_HEIGHT, Math.ceil(body.getBoundingClientRect().height));
    const growth = next - height;
    steps = growth > 0 && growth === lastGrowth ? steps + 1 : 0;
    lastGrowth = growth;
    if (steps >= 3) observer?.disconnect();
    height = next;
  }
  let lastGrowth = 0;

  const XLINK = "http://www.w3.org/1999/xlink";
  const linkAt = (target: EventTarget | null) => (target as Element | null)?.closest?.("a, area") ?? null;

  function loaded() {
    const d = frame?.contentDocument;
    if (!d) return;
    // Templates set html/body to height:100% (or 100vh), which in a frame sized to its content is 0, or forever.
    for (const el of [d.documentElement, d.body]) {
      el.style.setProperty("height", "auto", "important");
      el.style.setProperty("min-height", "0", "important");
    }
    // The mail font holds over inline font-family too (a style attribute's !important beats any style sheet).
    if (!paper) {
      for (const el of d.querySelectorAll<HTMLElement>("[style*='font' i]")) {
        if (!MONOSPACE.test(el.style.fontFamily)) el.style.removeProperty("font-family");
      }
    }
    observer?.disconnect();
    steps = lastGrowth = 0;
    observer = new ResizeObserver(() => requestAnimationFrame(measure)); // resizing inside the callback would loop
    observer.observe(d.body);
    d.addEventListener("load", measure, true); // images arriving change the height
    d.addEventListener("click", follow);
    d.addEventListener("contextmenu", menu);
    // The app's shortcuts keep working while focus is inside the message.
    d.addEventListener("keydown", (e) => window.dispatchEvent(new KeyboardEvent("keydown", e)));
    hasQuotes = !paper && !!d.querySelector(QUOTE_SELECTOR);
    // A forward without a note of its own is all "quote" (Gmail, Outlook and Apple Mail wrap it so): show it.
    if (paper || (hasQuotes && !showQuotes && !d.body.innerText.trim())) showQuotes = true;
    d.documentElement.classList.toggle("ib-show-quotes", showQuotes);
    measure();
  }
  $effect(() => () => observer?.disconnect());

  // Links never open inside the frame: web links go to the browser, mailto opens compose, anything else is ignored.
  // Image-map areas and SVG links count too (xlink:href, and href that isn't a plain string).
  function follow(e: MouseEvent) {
    const link = linkAt(e.target);
    if (!link) return;
    e.preventDefault();
    const raw = link.getAttribute("href") ?? link.getAttributeNS(XLINK, "href");
    if (!raw) return;
    let url: URL;
    try {
      url = new URL(raw, link.baseURI);
    } catch {
      return;
    }
    if (url.protocol === "mailto:") {
      if (paper) return; // in compose's preview of a reply's trail: a new message would replace the reply
      compose({ accountId, ...mailtoDraft(url.href) });
    } else if (url.protocol === "https:" || url.protocol === "http:") {
      if ("__TAURI_INTERNALS__" in window) openUrl(url.href).catch(console.error);
      else window.open(url.href, "_blank", "noopener");
    }
  }

  // As in the rest of the app: the webview's own menu (Reload, Open Link…) only for selected text, never on links.
  function menu(e: MouseEvent) {
    if (import.meta.env.DEV) return;
    if (linkAt(e.target) || !frame?.contentDocument?.getSelection()?.toString()) e.preventDefault();
  }

  function toggleQuotes() {
    showQuotes = !showQuotes;
    frame?.contentDocument?.documentElement.classList.toggle("ib-show-quotes", showQuotes);
    measure();
  }
</script>

<!-- What can be changed about how this message shows, on one quiet line above it. -->
{#if !paper && (blocked || recolorable)}
  <div class="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-caption text-ink-muted">
    {#if blocked}
      <span>Images are blocked, so the sender can't see you opened this.</span>
      <button class="pill-btn" onclick={() => (remote = true)}>Load images</button>
    {/if}
    {#if recolorable}
      <!-- Darkening is a guess about someone else's design: the original is one click away. -->
      <button class="pill-btn ml-auto" aria-pressed={original} onclick={() => (original = !original)}>Original colors</button>
    {/if}
  </div>
{/if}
<!-- allow-same-origin only: no scripts, forms, popups or navigation; the page can measure it and catch clicks. -->
<iframe
  bind:this={frame}
  title="Message"
  sandbox="allow-same-origin"
  srcdoc={doc}
  onload={loaded}
  class="block w-full"
  style:background={dark ? "#121212" : "#fff"}
  style:height="{height}px"
></iframe>
{#if hasQuotes}
  <button
    class="mt-3 grid h-6 w-9 place-items-center rounded-full bg-raised text-ink-muted transition-colors duration-100 hover:text-ink active:bg-ink/10"
    aria-label={showQuotes ? "Hide quoted text" : "Show quoted text"}
    aria-expanded={showQuotes}
    onclick={toggleQuotes}
  >
    <Icon icon={MoreHorizontalIcon} size={14} />
  </button>
{/if}
