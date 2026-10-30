<script lang="ts">
  import { Attachment01Icon, InboxIcon, PencilEdit02Icon, Search01Icon, StarIcon } from "@hugeicons/core-free-icons";
  import Icon from "./Icon.svelte";
  import FolderMenu from "./FolderMenu.svelte";
  import { contextmenu } from "$lib/contextmenu";
  import { threadMenu } from "$lib/menus";
  import { compose, data, syncNow, ui, openThread } from "$lib/state.svelte";
  import { dateGroup, formatDate } from "$lib/format";
  import { settings } from "$lib/settings.svelte";
  import { isFocused, isInbox } from "$lib/views";

  const formatTime = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  import type { ThreadSummary } from "$lib/types";

  // An inbox splits into Focused (conversations with the domains chosen in Settings) and Other; a search covers both.
  const tabbed = $derived(!ui.query.trim() && isInbox(data.mailboxes, ui.accountId, ui.mailboxKey));
  const focused = $derived(data.list.filter((t) => isFocused(t, settings.notifyDomains)));
  const other = $derived(data.list.filter((t) => !isFocused(t, settings.notifyDomains)));
  const list = $derived(tabbed ? (ui.focus === "focused" ? focused : other) : data.list); // the engine filtered and searched
  const tabs = $derived([
    { id: "focused" as const, label: "Focused", unread: focused.filter((t) => t.unread).length },
    { id: "other" as const, label: "Other", unread: other.filter((t) => t.unread).length },
  ]);
  // Tabs as the platform does them: arrows move between them, and the tab follows focus.
  function tabArrows(e: KeyboardEvent) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    ui.focus = ui.focus === "focused" ? "other" : "focused";
    document.getElementById(`list-tab-${ui.focus}`)?.focus();
  }
  function chooseDomains() {
    ui.settingsTab = "Notifications";
    ui.settingsOpen = true;
  }
  const accountColor = (id: string) => data.accounts.find((a) => a.id === id)?.color;
  const account = $derived(data.accounts.find((a) => a.id === ui.accountId));
  const importing = $derived(data.accounts.filter((a) => a.sync?.state === "importing"));
  const failing = $derived(data.accounts.filter((a) => a.sync?.state === "error"));
  const isMac = typeof navigator !== "undefined" && navigator.platform.startsWith("Mac");

  // The day gutter: runs of conversations under one day (the last seven days) or month. The engine sends newest
  // first, so each group appears once.
  const groups = $derived.by(() => {
    const now = new Date();
    const out: (ReturnType<typeof dateGroup> & { threads: ThreadSummary[] })[] = [];
    for (const t of list) {
      const g = dateGroup(t.lastDate, now);
      if (out.at(-1)?.key === g.key) out.at(-1)!.threads.push(t);
      else out.push({ ...g, threads: [t] });
    }
    return out;
  });

  // On the window, because WebKit doesn't focus a button when it's clicked.
  function move(e: KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    // Only when the list, or nothing, has focus: arrows inside a field belong to that field.
    const target = e.target as HTMLElement;
    if (target !== document.body && !target.closest("#message-list")) return;
    e.preventDefault();
    const i = list.findIndex((t) => t.id === ui.threadId);
    const next = list[i === -1 ? 0 : i + (e.key === "ArrowDown" ? 1 : -1)];
    if (!next) return;
    openThread(next.id);
    document.getElementById(`thread-${next.id}`)?.focus();
  }
</script>

<svelte:window onkeydown={move} />

<section aria-label="Messages" class="flex h-full flex-col">
  <!-- pl-8: the window's traffic lights sit over the rail and this header's start, so the folder switcher begins past them. -->
  <header data-tauri-drag-region class="flex h-13 shrink-0 items-center justify-between gap-3 pr-3 pl-8">
    <FolderMenu />
    <button class="icon-btn shrink-0" aria-label="New message" title="New message ({isMac ? '⌘N' : 'Ctrl+N'})" onclick={() => compose()}>
      <Icon icon={PencilEdit02Icon} size={17} />
    </button>
  </header>

  <!-- Which account this is, and how its sync is going. -->
  <div class="-mt-2 pr-4 pb-3 pl-8 text-caption text-ink-muted">
    {#if account?.sync?.state === "importing"}
      {@const { done, total } = account.sync}
      <!-- No live region: a counter that changes every second and a half would talk over everything. -->
      <p>{total ? `Importing ${done.toLocaleString()} of ${total.toLocaleString()}` : "Looking for mail…"}</p>
      <progress class="import mt-1.5" max={total || undefined} value={total ? done : undefined} aria-label="Import progress"
      ></progress>
    {:else if account?.sync?.state === "error"}
      <p class="wrap-anywhere">
        Couldn't sync: {account.sync.error}
        <button class="font-medium text-ink underline underline-offset-2" onclick={() => syncNow(account.id)}>Try again</button>
      </p>
    {:else if !account && failing.length}
      <!-- The account's own view has the reason and Try again. -->
      <p class="wrap-anywhere">Couldn't sync {failing.map((a) => a.name).join(", ")}</p>
    {:else if !account && importing.length}
      <p>Importing mail…</p>
    {:else}
      <p class="truncate" title={account?.email}>{account ? `${account.name}, ${account.email}` : "All inboxes"}</p>
    {/if}
  </div>

  <div class="px-3 pb-2">
    <label
      class="flex h-8 items-center gap-2 rounded-md border border-line bg-canvas px-2.5 text-ink-muted transition-colors duration-100 focus-within:border-ink"
    >
      <Icon icon={Search01Icon} size={14} />
      <input
        bind:value={ui.query}
        placeholder="Search"
        aria-label="Search messages"
        onkeydown={(e) => {
          if (e.key !== "Escape") return;
          e.preventDefault(); // handled here, so an open compose panel stays open
          ui.query = "";
        }}
        class="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-muted"
      />
    </label>
  </div>

  {#if tabbed}
    <div role="tablist" aria-label="Inbox" tabindex="-1" class="mx-3 mb-1 flex gap-4 border-b border-line" onkeydown={tabArrows}>
      {#each tabs as t (t.id)}
        {@const selected = ui.focus === t.id}
        <button
          id="list-tab-{t.id}"
          role="tab"
          aria-selected={selected}
          aria-controls="message-list"
          tabindex={selected ? 0 : -1}
          class="-mb-px flex items-center gap-1.5 border-b-2 px-0.5 pb-2 transition-colors duration-100 active:text-ink {selected
            ? 'border-accent font-medium text-ink'
            : 'border-transparent text-ink-muted hover:text-ink'}"
          onclick={() => (ui.focus = t.id)}
        >
          {t.label}
          {#if t.unread}
            <span class="grid h-4.5 min-w-4.5 place-items-center rounded-full bg-accent px-1.5 text-caption font-semibold text-on-accent tabular-nums"
              >{t.unread > 99 ? "99+" : t.unread}<span class="sr-only"> unread</span></span
            >
          {/if}
        </button>
      {/each}
    </div>
  {/if}

  {#if list.length}
    <div id="message-list" role={tabbed ? "tabpanel" : undefined} aria-labelledby={tabbed ? `list-tab-${ui.focus}` : undefined} class="min-h-0 flex-1 overflow-y-auto pr-2 pb-2">
      {#each groups as g (g.key)}
        <!-- A day (or month) in the gutter, pinned while its conversations scroll past; the hairline is the spine. -->
        <section aria-label={g.name} class="grid grid-cols-[5.5rem_minmax(0,1fr)]">
          <div aria-hidden="true">
            <p class="sticky top-0 pt-2 pr-3 text-right">
              <span class="block text-day tabular-nums">{g.big}</span>
              {#if g.small}<span class="block text-caption text-ink-muted">{g.small}</span>{/if}
            </p>
          </div>
          <ul class="border-l border-line pt-1 pb-3 pl-1.5">
            {#each g.threads as t (t.id)}
              {@const selected = ui.threadId === t.id}
              <li class="relative">
                {#if ui.accountId === "all"}
                  <!-- Whose mail: a tick in the account's color, on the spine. -->
                  <span class="absolute top-3 -left-2 h-4 w-0.75 rounded-full" style:background={accountColor(t.accountId)}
                  ></span>
                {/if}
                <button
                  id="thread-{t.id}"
                  class="relative flex w-full flex-col gap-0.5 rounded-lg py-2.5 pr-3 pl-5 text-left transition-colors duration-100 {selected
                    ? 'bg-selected focus-visible:outline-none'
                    : 'hover:bg-ink/5 active:bg-ink/10'}"
                  aria-current={selected ? "true" : undefined}
                  onclick={() => openThread(t.id)}
                  use:contextmenu={() => threadMenu(t, true)}
                >
                  {#if t.unread}
                    <span class="absolute top-[1.0625rem] left-2 size-1.5 rounded-full bg-accent"></span>
                    <span class="sr-only">Unread.</span>
                  {/if}
                  <span class="flex items-center gap-2">
                    <span class="min-w-0 flex-1 truncate {t.unread ? 'font-semibold' : 'font-medium'}">
                      {t.participants.map((p) => p.name).join(", ")}
                    </span>
                    <!-- The gutter already says which day: rows in a day give the time, rows in a month the date. -->
                    <time datetime={t.lastDate} class="shrink-0 text-caption text-ink-muted"
                      >{g.day ? formatTime(t.lastDate) : formatDate(t.lastDate)}</time
                    >
                  </span>
                  <span class="flex items-center gap-1.5">
                    <span class="min-w-0 flex-1 truncate">{t.subject}</span>
                    {#if t.hasAttachments}
                      <Icon icon={Attachment01Icon} size={13} class="shrink-0 text-ink-muted" />
                      <span class="sr-only">Has attachments.</span>
                    {/if}
                    {#if t.starred}
                      <Icon icon={StarIcon} size={13} class="shrink-0 fill-accent text-accent" />
                      <span class="sr-only">Starred.</span>
                    {/if}
                  </span>
                  <span class="line-clamp-2 text-ink-muted">{t.snippet}</span>
                </button>
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    </div>
  {:else if data.accounts.length === 0}
    <div class="grid flex-1 place-items-center px-6 text-center">
      <div class="flex flex-col items-center gap-2">
        <Icon icon={InboxIcon} size={28} class="text-ink-muted" />
        <p class="font-medium">No accounts yet</p>
        <p class="text-ink-muted">Add an IMAP account to bring its mail here.</p>
        <button class="btn-primary mt-3" onclick={() => (ui.addingAccount = true)}>Add account</button>
      </div>
    </div>
  {:else if tabbed && ui.focus === "other" && !settings.notifyDomains.trim() && data.list.length}
    <!-- With no domains chosen, everything is Focused: say how to sort mail here. -->
    <div class="grid flex-1 place-items-center px-8 text-center">
      <div class="flex flex-col items-center gap-2">
        <Icon icon={InboxIcon} size={28} class="text-ink-muted" />
        <p class="font-medium">Everything is in Focused</p>
        <p class="text-balance text-ink-muted">Choose the sender domains that matter to you. Their mail stays in Focused, and the rest comes here.</p>
        <button class="btn-secondary mt-3" onclick={chooseDomains}>Choose domains</button>
      </div>
    </div>
  {:else}
    <div class="grid flex-1 place-items-center text-ink-muted">
      <div class="flex flex-col items-center gap-2">
        <Icon icon={InboxIcon} size={28} />
        <p>{ui.query ? "No results" : tabbed ? `Nothing in ${ui.focus === "focused" ? "Focused" : "Other"}` : "No messages"}</p>
      </div>
    </div>
  {/if}
</section>
