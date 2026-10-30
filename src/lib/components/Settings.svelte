<script lang="ts">
  import {
    BookOpen01Icon,
    Notification01Icon,
    PaintBoardIcon,
    PencilEdit02Icon,
    UserMultipleIcon,
  } from "@hugeicons/core-free-icons";
  import Avatar from "./Avatar.svelte";
  import Icon from "./Icon.svelte";
  import { data, renameAccount, senders, ui, updateBadge } from "$lib/state.svelte";
  import { baseCss, COLORS, FONTS as COMPOSE_FONTS, SIZES } from "$lib/rich";
  import { composeStyle, FONTS, saveSettings, settings } from "$lib/settings.svelte";
  import { chooseTheme, theme } from "$lib/theme.svelte";

  let dialog = $state<HTMLDialogElement>();
  $effect(() => dialog?.showModal());

  const sections = [
    { id: "Appearance", icon: PaintBoardIcon },
    { id: "Reading", icon: BookOpen01Icon },
    { id: "Compose", icon: PencilEdit02Icon },
    { id: "Notifications", icon: Notification01Icon },
    { id: "Accounts", icon: UserMultipleIcon },
  ] as const;
  type Section = (typeof sections)[number]["id"];
  let section = $state<Section>(sections.find((s) => s.id === ui.settingsTab)?.id ?? "Appearance");

  // Each theme drawn as a small window: sidebar, a list, a reading pane. System is both, split.
  const themes = [
    { id: "system", name: "System" },
    { id: "light", name: "Light" },
    { id: "dark", name: "Dark" },
  ] as const;
  const PAINT = {
    light: { canvas: "#ffffff", side: "#f5f5f5", line: "#e5e5e5", ink: "#171717" },
    dark: { canvas: "#121212", side: "#171717", line: "#ffffff1a", ink: "#fafafa" },
  };

  // Sections as the platform does them: arrows move between them, and the section follows focus.
  function arrows(e: KeyboardEvent) {
    const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const i = sections.findIndex((s) => s.id === section);
    section = sections[(i + step + sections.length) % sections.length].id;
    document.getElementById(`settings-tab-${section}`)?.focus();
  }

  function set<K extends keyof typeof settings>(key: K, value: (typeof settings)[K]) {
    settings[key] = value;
    saveSettings();
  }
</script>

<!-- Choices apply as they're made: there's nothing to save, so the only button is Done. -->
<dialog
  bind:this={dialog}
  onclose={() => {
    ui.settingsOpen = false;
    ui.settingsTab = "Appearance";
  }}
  aria-labelledby="settings-title"
  class="m-auto flex h-[min(40rem,calc(100vh-4rem))] w-[50rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-line bg-float text-ink shadow-float backdrop:bg-ink/30"
>
  <nav class="flex w-48 shrink-0 flex-col border-r border-line bg-sidebar px-3 pt-5 pb-3">
    <h2 id="settings-title" class="px-2.5 text-heading">Settings</h2>
    <div role="tablist" aria-label="Settings sections" aria-orientation="vertical" tabindex="-1" class="mt-4 flex flex-col gap-0.5" onkeydown={arrows}>
      {#each sections as s (s.id)}
        {@const current = section === s.id}
        <button
          id="settings-tab-{s.id}"
          role="tab"
          aria-selected={current}
          aria-controls="settings-panel"
          tabindex={current ? 0 : -1}
          class="flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-left transition-colors duration-100 {current
            ? 'bg-selected font-medium text-ink'
            : 'text-ink-muted hover:bg-ink/5 hover:text-ink active:bg-ink/10'}"
          onclick={() => (section = s.id)}
        >
          <Icon icon={s.icon} size={16} />
          {s.id}
        </button>
      {/each}
    </div>
  </nav>

  <div class="flex min-w-0 flex-1 flex-col">
    <header class="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-line px-6">
      <h3 class="text-title font-semibold">{section}</h3>
      <button class="btn-primary" onclick={() => dialog?.close()}>Done</button>
    </header>

    <div id="settings-panel" role="tabpanel" aria-labelledby="settings-tab-{section}" class="min-h-0 flex-1 overflow-y-auto px-6 pt-5 pb-8">
      {#if section === "Appearance"}
        <fieldset>
          <legend class="font-medium">Theme</legend>
          <div class="mt-3 grid grid-cols-3 gap-3">
            {#each themes as t (t.id)}
              <label class="group flex flex-col items-center gap-2">
                <input type="radio" name="theme" class="peer sr-only" checked={theme.choice === t.id} onchange={() => chooseTheme(t.id)} />
                <span
                  class="relative block aspect-[16/10] w-full overflow-hidden rounded-xl border border-line transition-shadow duration-150 group-active:scale-[0.98] peer-checked:ring-2 peer-checked:ring-accent peer-checked:ring-offset-2 peer-checked:ring-offset-float peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-accent"
                  aria-hidden="true"
                >
                  {#each t.id === "system" ? (["light", "dark"] as const) : [t.id] as mode, i (mode)}
                    {@const p = PAINT[mode]}
                    <span
                      class="absolute inset-0 flex"
                      style:background={p.canvas}
                      style:clip-path={t.id === "system" ? (i ? "polygon(100% 0, 100% 100%, 0 100%)" : "polygon(0 0, 100% 0, 0 100%)") : undefined}
                    >
                      <span class="w-[34%] space-y-1.5 px-2 pt-4" style:background={p.side}>
                        <span class="block h-1 w-3/4 rounded-full opacity-60" style:background={p.ink}></span>
                        <span class="block h-1 w-1/2 rounded-full opacity-25" style:background={p.ink}></span>
                        <span class="block h-1 w-2/3 rounded-full opacity-25" style:background={p.ink}></span>
                      </span>
                      <span class="flex-1 space-y-1.5 border-l px-2.5 pt-4" style:border-color={p.line}>
                        <span class="block h-1.5 w-1/2 rounded-full opacity-70" style:background={p.ink}></span>
                        <span class="block h-1 w-full rounded-full opacity-20" style:background={p.ink}></span>
                        <span class="block h-1 w-5/6 rounded-full opacity-20" style:background={p.ink}></span>
                        <span class="block h-1 w-2/3 rounded-full opacity-20" style:background={p.ink}></span>
                      </span>
                    </span>
                  {/each}
                </span>
                <span class="text-ink-muted peer-checked:font-medium peer-checked:text-ink">{t.name}</span>
              </label>
            {/each}
          </div>
          <p class="mt-3 text-caption text-ink-muted">System follows your Mac's light or dark appearance.</p>
        </fieldset>

        <fieldset class="mt-8">
          <legend class="font-medium">Mail font</legend>
          <p class="mt-1 text-caption text-ink-muted">Every message you read is shown in this font, whatever the sender chose.</p>
          <div class="mt-3 grid grid-cols-4 gap-2">
            {#each FONTS as f (f.id)}
              <label
                class="flex flex-col gap-3 rounded-xl border border-line px-3 pt-3 pb-2.5 transition-colors duration-100 hover:bg-ink/5 active:bg-ink/10 has-checked:border-accent has-checked:bg-selected has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent"
              >
                <input type="radio" name="mail-font" class="sr-only" checked={settings.mailFont === f.id} onchange={() => set("mailFont", f.id)} />
                <span class="text-title" style:font-family={f.family} aria-hidden="true">Aa</span>
                <span class="truncate text-caption" style:font-family={f.family}>{f.name}</span>
              </label>
            {/each}
          </div>
          <p class="mt-3 truncate text-read text-ink-muted" style:font-family={FONTS.find((f) => f.id === settings.mailFont)?.family}>
            Thanks for the notes. I'll send the draft on Monday.
          </p>
        </fieldset>
      {:else if section === "Reading"}
        <div class="group-box">
          {@render toggle("markRead", "Mark as read when opened", "Off: conversations stay unread until you mark them read.")}
          {@render toggle(
            "loadImages",
            "Load remote images automatically",
            "Senders can then tell when you open their mail, and where you are. Off: each message asks first.",
          )}
        </div>
      {:else if section === "Compose"}
        <!-- What new mail looks like, on the same white page as the compose window. -->
        <div class="compose-scroll overflow-hidden rounded-xl border border-line">
          <div class="px-5 py-4 leading-normal" style={baseCss(composeStyle())}>
            <p>Hi Maya,</p>
            <p class="mt-[1.5em]">Thanks for the notes. I'll send the draft on Monday, with the photos from the site visit.</p>
            <p class="mt-[1.5em]">Sam</p>
          </div>
        </div>

        <div class="group-box mt-4">
          <label class="row">
            <span class="row-label">Font</span>
            <select class="row-select w-44" value={settings.composeFont} onchange={(e) => set("composeFont", e.currentTarget.value)}>
              {#each COMPOSE_FONTS as f (f.label)}<option value={f.stack}>{f.stack ? f.label : "System"}</option>{/each}
            </select>
          </label>
          <label class="row">
            <span class="row-label">Size</span>
            <select class="row-select w-24 tabular-nums" value={settings.composeSize} onchange={(e) => set("composeSize", Number(e.currentTarget.value))}>
              {#each SIZES as s (s)}<option value={s}>{s} pt</option>{/each}
            </select>
          </label>
          <fieldset class="row">
            <legend class="sr-only">Color</legend>
            <span class="row-label" aria-hidden="true">Color</span>
            <span class="flex flex-wrap justify-end gap-1.5">
              {#each ["", ...COLORS] as c (c)}
                <label class="grid size-6 place-items-center rounded-full transition-transform duration-100 active:scale-90 has-checked:ring-2 has-checked:ring-accent has-checked:ring-offset-2 has-checked:ring-offset-float has-focus-visible:outline-2 has-focus-visible:outline-offset-4 has-focus-visible:outline-accent" title={c || "Automatic"}>
                  <input type="radio" name="compose-color" class="sr-only" aria-label={c || "Automatic"} checked={settings.composeColor === c} onchange={() => set("composeColor", c)} />
                  <span
                    class="size-6 rounded-full border border-line {c ? '' : 'bg-[linear-gradient(135deg,#000_50%,#fff_50%)]'}"
                    style:background-color={c || undefined}
                  ></span>
                </label>
              {/each}
            </span>
          </fieldset>
        </div>
        <p class="mt-2 px-1 text-caption text-ink-muted">New messages, replies and forwards start in this style. Change any of it as you write.</p>

        <h4 class="mt-8 font-medium">Signatures</h4>
        {#if senders().length}
          <div class="group-box mt-3">
            {#each senders() as a (a.id)}
              <label class="block px-4 py-3">
                <span class="flex items-center gap-2.5">
                  <Avatar name={a.name} color={a.color} size={20} />
                  <span class="min-w-0 truncate font-medium">{a.name}</span>
                  <span class="min-w-0 truncate text-caption text-ink-muted">{a.email}</span>
                </span>
                <textarea
                  rows="3"
                  class="mt-2.5 w-full resize-y rounded-md border border-line bg-canvas px-3 py-2 text-ink outline-none transition-colors duration-100 focus:border-ink"
                  placeholder="Added to new messages, replies and forwards from this account"
                  value={settings.signatures[a.id] ?? ""}
                  oninput={(e) => {
                    settings.signatures[a.id] = e.currentTarget.value;
                    saveSettings();
                  }}
                ></textarea>
              </label>
            {/each}
          </div>
        {:else}
          <p class="mt-1 text-caption text-ink-muted">Add an account to give its mail a signature.</p>
        {/if}
      {:else if section === "Notifications"}
        <label class="block">
          <span class="font-medium">Focused senders</span>
          <span class="mt-1 block text-caption text-ink-muted">
            Mail from these domains goes to Focused in your inboxes, and only it notifies you. Everything else waits in Other.
          </span>
          <textarea
            rows="4"
            class="mt-3 w-full resize-y rounded-xl border border-line bg-canvas px-3.5 py-2.5 text-ink outline-none transition-colors duration-100 focus:border-ink"
            placeholder={"northwind.studio\nhalden.shop"}
            value={settings.notifyDomains}
            oninput={(e) => set("notifyDomains", e.currentTarget.value)}
          ></textarea>
          <span class="mt-1.5 block text-caption text-ink-muted">One per line; subdomains count too. Empty: all mail is Focused.</span>
        </label>

        <div class="group-box mt-6">
          {@render toggle(
            "notify",
            "Notify me about new mail",
            "One for each message, while Inboxed isn't the app in front or its window is closed. In front, a banner shows it.",
          )}
          {@render toggle("sound", "Play a sound", "With each notification.", !settings.notify)}
          {@render toggle("dockBadge", "Unread count on the Dock icon", "The number of unread conversations in your inboxes.", false, updateBadge)}
        </div>
      {:else}
        {#if data.accounts.length}
          <div class="group-box">
            {#each data.accounts as a (a.id)}
              <div class="flex items-center gap-3 px-4 py-3">
                <Avatar name={a.name} color={a.color} size={32} />
                <span class="min-w-0 flex-1">
                  <!-- Edited in place: Enter or leaving the field saves, Esc puts the name back (and keeps Settings open). -->
                  <input
                    class="-mx-1.5 block h-7 w-[calc(100%+0.75rem)] min-w-0 rounded-md bg-transparent px-1.5 font-medium text-ink outline-none transition-colors duration-100 hover:bg-ink/5 focus:bg-canvas focus:ring-1 focus:ring-ink"
                    aria-label="Name of {a.email}"
                    title="Rename"
                    value={a.name}
                    spellcheck="false"
                    autocomplete="off"
                    onkeydown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      else if (e.key === "Escape") {
                        e.preventDefault();
                        e.currentTarget.value = a.name;
                        e.currentTarget.blur();
                      }
                    }}
                    onblur={(e) => {
                      renameAccount(a.id, e.currentTarget.value);
                      e.currentTarget.value = a.name; // trimmed, or the address when left empty
                    }}
                  />
                  <span class="block truncate text-caption text-ink-muted">{a.email}</span>
                </span>
                <button class="btn-secondary h-7 px-3 text-caption" onclick={() => (ui.removingAccount = a.id)}>Remove…</button>
              </div>
            {/each}
          </div>
          <p class="mt-2 px-1 text-caption text-ink-muted">
            Click a name to change it. It's how the account shows in Inboxed and the sender name on mail you send from it.
          </p>
        {:else}
          <p class="text-ink-muted">No accounts yet. Add one to bring its mail here.</p>
        {/if}
        <button class="btn-secondary mt-4" onclick={() => (ui.addingAccount = true)}>Add account</button>
      {/if}
    </div>
  </div>
</dialog>

{#snippet toggle(
  key: "markRead" | "loadImages" | "notify" | "sound" | "dockBadge",
  label: string,
  hint: string,
  disabled = false,
  after?: () => void,
)}
  <label class="flex items-start gap-4 px-4 py-3 {disabled ? 'opacity-50' : ''}">
    <span class="min-w-0 flex-1">
      <span class="block font-medium">{label}</span>
      <span class="mt-0.5 block text-caption text-ink-muted">{hint}</span>
    </span>
    <input
      type="checkbox"
      role="switch"
      class="switch mt-0.5"
      {disabled}
      checked={settings[key]}
      onchange={(e) => {
        set(key, e.currentTarget.checked);
        after?.();
      }}
    />
  </label>
{/snippet}

<style>
  /* Settings that belong together, in one hairline box with hairlines between them. */
  .group-box {
    border: 1px solid var(--color-line);
    border-radius: 0.75rem;
    & > :global(* + *) {
      border-top: 1px solid var(--color-line);
    }
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    min-height: 3rem;
    padding: 0.5rem 1rem;
  }
  .row-label {
    font-weight: 500;
  }
  .row-select {
    height: 2rem;
    border-radius: 0.5rem;
    border: 1px solid var(--color-line);
    background: var(--color-canvas);
    padding: 0 0.5rem;
    color: var(--color-ink);
    outline: none;
    &:focus-visible {
      border-color: var(--color-ink);
    }
  }
</style>
