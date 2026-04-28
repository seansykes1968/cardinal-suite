/// Background thread that watches whether the configured watch root is
/// accessible and emits `drive_status` events to the frontend when the mount
/// state changes.
///
/// This handles two scenarios:
///   1. Cardinal opens while the drive is not mounted (e.g. user hasn't
///      connected to Suite yet in the morning).
///   2. The drive is unmounted while Cardinal is running (e.g. network drops,
///      VPN disconnects, or the user manually ejects the volume).
///
/// Emitted event: `"drive_status"` with payload `"mounted"` | `"unmounted"`.
/// The frontend hook `useDriveStatus` listens for this event.
///
/// The thread exits cleanly when `APP_QUIT` is set (i.e. the app is quitting).
use crate::lifecycle::APP_QUIT;
use std::{path::PathBuf, sync::atomic::Ordering, time::Duration};
use tauri::Emitter;
use tracing::info;

const POLL_INTERVAL: Duration = Duration::from_secs(5);

/// Spawn a drive-monitor thread and return immediately.
///
/// The thread owns `app_handle` and `watch_root` — no external synchronisation
/// is needed. It emits the initial state before entering the poll loop so the
/// frontend always receives at least one event on startup.
pub fn start_drive_monitor(app_handle: tauri::AppHandle, watch_root: PathBuf) {
    std::thread::spawn(move || {
        let mut was_mounted = watch_root.exists();
        let initial = status_str(was_mounted);
        info!(
            "Drive monitor started: watch_root={:?} initial_status={}",
            watch_root, initial
        );
        app_handle.emit("drive_status", initial).ok();

        loop {
            std::thread::sleep(POLL_INTERVAL);

            if APP_QUIT.load(Ordering::Relaxed) {
                info!("Drive monitor exiting");
                break;
            }

            let is_mounted = watch_root.exists();
            if is_mounted != was_mounted {
                was_mounted = is_mounted;
                let status = status_str(is_mounted);
                info!("Drive status changed → {}", status);
                app_handle.emit("drive_status", status).ok();
            }
        }
    });
}

fn status_str(mounted: bool) -> &'static str {
    if mounted {
        "mounted"
    } else {
        "unmounted"
    }
}
