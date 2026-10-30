use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{plugin::TauriPlugin, Manager, Runtime, Url};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_shell::{process::{CommandChild, CommandEvent}, ShellExt};
use tokio::sync::watch;

/// Connection details for the Go engine sidecar, handed to the frontend.
#[derive(Clone, Serialize, Deserialize)]
struct Engine {
    url: String,
    token: String,
}

#[derive(Deserialize)]
struct Handshake {
    port: u16,
    token: String,
}

struct EngineState {
    ready: watch::Receiver<Option<Engine>>,
    // Holding the child keeps its stdin open. The engine exits when stdin closes.
    _child: Mutex<CommandChild>,
}

/// Waits until the engine has printed its handshake, then returns how to reach it.
#[tauri::command]
async fn engine(state: tauri::State<'_, EngineState>) -> Result<Engine, String> {
    let mut rx = state.ready.clone();
    let engine = rx
        .wait_for(Option::is_some)
        .await
        .map_err(|_| "engine exited before it was ready".to_string())?;
    Ok(engine.clone().unwrap())
}

/// Whether a navigation would put a web page inside Inboxed: anything on the web but the app itself (tauri.localhost;
/// in debug builds also the Vite dev server).
fn is_web(url: &Url, debug: bool) -> bool {
    let app = url.host_str() == Some("tauri.localhost")
        || (debug && url.host_str() == Some("localhost") && url.port() == Some(1420));
    matches!(url.scheme(), "http" | "https") && !app
}

/// Web pages never open inside Inboxed, in the window or in any frame of it. The page sends links to the browser itself;
/// this catches whatever it can't see (a link in a previewed PDF, a dropped link, one it missed): cancelled here, opened
/// in the browser instead.
fn links<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("links")
        .on_navigation(|webview, url| {
            if !is_web(url, cfg!(debug_assertions)) {
                return true;
            }
            if let Err(e) = webview.opener().open_url(url.as_str(), None::<&str>) {
                eprintln!("couldn't open {url}: {e}");
            }
            false
        })
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(links())
        .setup(|app| {
            // A force click on a link would show the page in a preview inside the window: links go to the browser.
            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                window.with_webview(|w| unsafe {
                    let view: &objc2_web_kit::WKWebView = &*w.inner().cast();
                    view.setAllowsLinkPreview(false);
                })?;
            }
            // The engine keeps its database in the app data folder (~/Library/Application Support/dev.inboxed.app).
            // Debug builds get their own subfolder, so accounts added while developing never mix with a real install's.
            let debug = cfg!(debug_assertions);
            // `npm run demo` (INBOXED_DEMO=1, debug builds only) shows demo mail for screenshots, from a folder of its own
            // that starts empty every launch, so the engine seeds it again with recent dates.
            let demo = debug && std::env::var("INBOXED_DEMO").as_deref() == Ok("1");
            let mut data_dir = app.path().app_data_dir()?;
            if debug {
                data_dir.push(if demo { "demo" } else { "debug" });
            }
            if demo && data_dir.exists() {
                std::fs::remove_dir_all(&data_dir)?;
            }
            std::fs::create_dir_all(&data_dir)?;
            let engine = app
                .shell()
                .sidecar("inboxed-engine")?
                .env("INBOXED_DATA_DIR", &data_dir)
                // Development-only knobs, set explicitly so a variable exported in the shell can't reach the engine.
                .env("INBOXED_SEED", if demo { "demo" } else { "" }) // the app seeds only in demo mode
                .env("INBOXED_ORIGINS", if debug { "http://localhost:1420" } else { "" }) // the Vite dev server
                .env("INBOXED_PORT", "")
                .env("INBOXED_TOKEN", "")
                .env("INBOXED_FAKE_KEYCHAIN", "");
            let (mut events, child) = engine.spawn()?;
            let (tx, rx) = watch::channel(None);
            app.manage(EngineState { ready: rx, _child: Mutex::new(child) });

            tauri::async_runtime::spawn(async move {
                while let Some(event) = events.recv().await {
                    match event {
                        CommandEvent::Stdout(line) if tx.borrow().is_none() => {
                            if let Ok(h) = serde_json::from_slice::<Handshake>(&line) {
                                let url = format!("http://127.0.0.1:{}", h.port);
                                tx.send_replace(Some(Engine { url, token: h.token }));
                            }
                        }
                        CommandEvent::Stderr(line) => {
                            eprintln!("[engine] {}", String::from_utf8_lossy(&line).trim_end())
                        }
                        CommandEvent::Terminated(p) => {
                            eprintln!("[engine] exited: {:?}", p.code);
                            break;
                        }
                        _ => {}
                    }
                }
            });
            Ok(())
        })
        // Closing the window only hides it: Inboxed keeps syncing and notifying until it's quit (⌘Q). The window's
        // webview isn't throttled while hidden ("backgroundThrottling" in tauri.conf.json), so new mail still arrives.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![engine])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // The Dock icon brings the hidden window back.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { has_visible_windows: false, .. } = event {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_web_leaves() {
        let web = |s: &str| is_web(&s.parse().unwrap(), false);
        assert!(web("https://example.com/a"));
        assert!(web("http://example.com"));
        assert!(!web("tauri://localhost/"));
        assert!(!web("http://tauri.localhost/"));
        assert!(web("http://localhost:1420/")); // the dev server is the app only in debug builds
        assert!(web("http://localhost:8080/"));
        assert!(!is_web(&"http://localhost:1420/".parse().unwrap(), true));
        assert!(is_web(&"http://localhost:8080/".parse().unwrap(), true));
        assert!(!web("about:srcdoc"));
        assert!(!web("blob:tauri://localhost/1234"));
        assert!(!web("mailto:a@example.com"));
    }
}
