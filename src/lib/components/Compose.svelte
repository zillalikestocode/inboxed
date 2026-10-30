<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import type { Editor } from "@tiptap/core";
  import { Attachment01Icon, Cancel01Icon, Delete02Icon, MoreHorizontalIcon } from "@hugeicons/core-free-icons";
  import { addRecipient, emailsIn, matchContacts } from "$lib/contacts";
  import { createEditor, type MentionState } from "$lib/editor";
  import { formatSize } from "$lib/format";
  import { baseCss } from "$lib/rich";
  import { composeStyle } from "$lib/settings.svelte";
  import AddressField from "./AddressField.svelte";
  import HtmlBody from "./HtmlBody.svelte";
  import Icon from "./Icon.svelte";
  import Suggestions from "./Suggestions.svelte";
  import Toolbar from "./Toolbar.svelte";
  import { rise } from "$lib/motion";
  import { attachFiles, changeSender, closeCompose, data, detach, discardDraft, sendDraft, senders, ui } from "$lib/state.svelte";

  let form = $state<HTMLFormElement>();
  let to = $state<HTMLInputElement>();
  let page = $state<HTMLElement>();
  let files = $state<HTMLInputElement>();
  let editor = $state<Editor>();
  let busy = $state<"" | "sending" | "saving">("");
  let dragging = $state(false);
  let mention = $state<MentionState | null>(null);
  let copies = $state(!!(ui.draft.cc || ui.draft.bcc)); // Cc and Bcc show once asked for, or when the draft has them
  const from = $derived(senders());
  const isMac = navigator.platform.startsWith("Mac");
  const everyone = $derived(emailsIn(`${ui.draft.to},${ui.draft.cc},${ui.draft.bcc}`));

  // A reply's history (Outlook's headers, then the message as it was) stays out of the editor, which would flatten its
  // layout, and goes with the message: html and body always end with it. ••• shows it under the editor, as it'll be sent.
  const trail = ui.trail;
  let showTrail = $state(false);
  const visible = () => {
    const html = ui.draft.html ?? "";
    return trail && html.endsWith(trail.html) ? html.slice(0, -trail.html.length) : html;
  };

  onMount(() => {
    editor = createEditor(page!, {
      html: visible(),
      style: baseCss(composeStyle()),
      onChange: (html, text) => {
        ui.draft.html = html + (trail?.html ?? "");
        ui.draft.body = text + (trail?.text ?? "");
      },
      mention: {
        items: (query) => matchContacts(data.contacts, query, []),
        show: (state) => (mention = state),
        // Mentioning someone brings them into the conversation.
        picked: (c) => {
          if (!everyone.includes(c.email.toLowerCase())) ui.draft.to = addRecipient(ui.draft.to, c);
        },
      },
    });
    // A reply already knows who it's for, so start in the message, above the quote.
    if (ui.draft.to) editor.commands.focus("start");
    else to?.focus();
  });
  onDestroy(() => editor?.destroy());

  function sender(accountId: string) {
    // The editor's own HTML: a resumed draft arrives as sent (emailHtml), where the old signature can't be found.
    changeSender(accountId, editor && editor.getHTML() + (trail?.html ?? ""));
    editor?.commands.setContent(visible(), { emitUpdate: false });
  }

  // Only the Send button and ⌘Enter send: the panel isn't a submitting form, so Enter in a field never does.
  async function send() {
    if (busy || ui.attaching || !from.length) return;
    busy = "sending";
    await sendDraft();
    busy = "";
  }

  // Closing saves what was typed as a draft; if that fails the panel stays open, so nothing is lost.
  async function close() {
    if (busy) return;
    busy = "saving";
    await closeCompose();
    busy = "";
  }

  const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files");
  function drop(e: DragEvent) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation(); // the editor would otherwise insert the file's name
    dragging = false;
    attachFiles([...(e.dataTransfer?.files ?? [])]);
  }
</script>

<!-- Esc closes the panel unless something else already handled it (a suggestion list, search, an IME, a dialog).
     ⌘Enter (Ctrl+Enter elsewhere) sends while typing in it. -->
<svelte:window
  onkeydown={(e) => {
    if (e.key === "Escape" && !e.defaultPrevented && !e.isComposing && !ui.addingAccount && !ui.removingAccount && !ui.preview && !ui.settingsOpen) close();
    if (e.key === "Enter" && (isMac ? e.metaKey : e.ctrlKey) && form?.contains(document.activeElement)) {
      e.preventDefault();
      send();
    }
  }}
/>

<form
  bind:this={form}
  transition:rise|global
  aria-label="New message"
  onsubmit={(e) => e.preventDefault()}
  ondragover={(e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragging = true;
  }}
  ondragleave={(e) => {
    if (!form?.contains(e.relatedTarget as Node)) dragging = false;
  }}
  ondropcapture={drop}
  class="fixed right-6 bottom-6 z-20 flex h-[36rem] max-h-[calc(100vh-3rem)] w-[42rem] max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-2xl border bg-float shadow-float {dragging
    ? 'border-dashed border-ink'
    : 'border-line'}"
>
  <header class="flex h-11 shrink-0 items-center justify-between border-b border-line pr-2 pl-4">
    <h2 class="truncate font-semibold">{ui.draft.subject || "New message"}</h2>
    <button type="button" class="icon-btn" aria-label="Close and save draft" title="Close" onclick={close}>
      <Icon icon={Cancel01Icon} size={16} />
    </button>
  </header>

  <label class="field">
    <span>From</span>
    {#if from.length}
      <select value={ui.draft.accountId} onchange={(e) => sender(e.currentTarget.value)}>
        {#each from as a (a.id)}
          <option value={a.id}>{a.name} · {a.email}</option>
        {/each}
      </select>
    {:else}
      <span class="w-auto! text-ink-muted">Add an account to send mail</span>
    {/if}
  </label>
  <!-- Plain text, not type=email: "Name <email>" is allowed, and the engine names any address it can't read. -->
  <AddressField label="To" bind:value={ui.draft.to} bind:input={to} contacts={data.contacts} exclude={everyone}>
    {#snippet end()}
      {#if !copies}
        <button type="button" class="shrink-0 rounded-md px-1.5 text-ink-muted transition-colors duration-100 hover:text-ink active:bg-ink/10" onclick={() => (copies = true)}>
          Cc Bcc
        </button>
      {/if}
    {/snippet}
  </AddressField>
  {#if copies}
    <AddressField label="Cc" bind:value={ui.draft.cc} contacts={data.contacts} exclude={everyone} />
    <AddressField label="Bcc" bind:value={ui.draft.bcc} contacts={data.contacts} exclude={everyone} />
  {/if}
  <label class="field"><span>Subject</span><input bind:value={ui.draft.subject} /></label>

  {#if editor}<Toolbar {editor} />{/if}
  <!-- Mail is written on white, like it's read; the dark theme inverts the page as it does received mail. -->
  <div class="compose-scroll flex min-h-0 flex-1 flex-col overflow-y-auto">
    <!-- The page fills the panel, so a click anywhere below the text lands in it; with the trail open, the trail follows the text. -->
    <div bind:this={page} class="flex flex-col {showTrail ? '' : 'flex-1'}"></div>
    {#if trail}
      <!-- On the paper: its colors are the page's, and the dark theme inverts them with it. -->
      <button
        type="button"
        class="mx-4 my-2 grid h-6 w-9 shrink-0 place-items-center rounded-full bg-[#0000000d] text-[#737373] transition-colors duration-100 hover:text-[#1c1b1b] active:bg-[#0000001a]"
        aria-label={showTrail ? "Hide quoted text" : "Show quoted text"}
        aria-expanded={showTrail}
        title={showTrail ? "Hide quoted text" : "Show quoted text"}
        onclick={() => (showTrail = !showTrail)}
      >
        <Icon icon={MoreHorizontalIcon} size={14} />
      </button>
      {#if showTrail}
        <div class="px-4 pb-4"><HtmlBody html={trail.html} accountId={ui.draft.accountId} paper /></div>
      {/if}
    {/if}
  </div>

  {#if ui.draft.attachments.length || ui.attaching}
    <ul class="flex shrink-0 flex-wrap gap-2 border-t border-line px-4 py-2.5" aria-label="Attachments">
      {#each ui.draft.attachments as a, i (a.hash ?? i)}
        <li class="flex items-center gap-1.5 rounded-full border border-line py-1 pr-1 pl-3 text-caption">
          <Icon icon={Attachment01Icon} size={12} class="text-ink-muted" />
          <span class="max-w-56 truncate">{a.name}</span>
          <span class="text-ink-muted">{formatSize(a.size)}</span>
          <button
            type="button"
            class="grid size-5 place-items-center rounded-full text-ink-muted transition-colors duration-100 hover:bg-ink/5 hover:text-ink active:bg-ink/10"
            aria-label="Remove {a.name}"
            title="Remove"
            onclick={() => detach(i)}
          >
            <Icon icon={Cancel01Icon} size={12} />
          </button>
        </li>
      {/each}
      {#if ui.attaching}<li class="flex items-center px-1 text-caption text-ink-muted">Attaching…</li>{/if}
    </ul>
  {/if}
  {#if ui.composeError}
    <p role="alert" class="mx-3 mb-2 rounded-lg bg-raised px-3 py-2 wrap-anywhere">{ui.composeError}</p>
  {/if}
  <footer class="flex shrink-0 items-center justify-between border-t border-line px-3 py-2">
    <span class="flex items-center gap-1">
      <button type="button" class="icon-btn" aria-label="Discard draft" title="Discard draft" disabled={!!busy} onclick={discardDraft}>
        <Icon icon={Delete02Icon} size={16} />
      </button>
      <button type="button" class="icon-btn" aria-label="Attach files" title="Attach files (or drop them here)" onclick={() => files?.click()}>
        <Icon icon={Attachment01Icon} size={16} />
      </button>
      <input
        bind:this={files}
        type="file"
        multiple
        hidden
        onchange={(e) => {
          attachFiles([...(e.currentTarget.files ?? [])]);
          e.currentTarget.value = ""; // the same file can be picked again
        }}
      />
    </span>
    <span class="flex items-center gap-3">
      {#if busy === "saving"}<span class="text-caption text-ink-muted">Saving draft…</span>{/if}
      <button
        type="button"
        class="btn-primary"
        disabled={!from.length || !!busy || ui.attaching > 0}
        title="Send ({isMac ? '⌘' : 'Ctrl+'}Enter)"
        onclick={send}
      >
        {busy === "sending" ? "Sending…" : "Send"}
      </button>
    </span>
  </footer>

  {#if mention?.rect}
    <!-- Below the caret, or above it near the bottom of the window. -->
    {@const below = mention.rect.bottom + 300 < innerHeight}
    <div
      class="fixed z-40"
      style:left="{Math.min(mention.rect.left, innerWidth - 336)}px"
      style:top={below ? `${mention.rect.bottom + 4}px` : undefined}
      style:bottom={below ? undefined : `${innerHeight - mention.rect.top + 4}px`}
    >
      <Suggestions id="suggest-mention" items={mention.items} active={mention.active} onpick={mention.pick} />
    </div>
  {/if}
</form>
