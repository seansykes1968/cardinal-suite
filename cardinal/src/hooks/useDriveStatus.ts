import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { DriveStatus } from '../types/ipc';

/**
 * Subscribes to the `drive_status` Tauri event emitted by the Rust
 * drive-monitor thread and returns the current mount state of the watch root.
 *
 * Values:
 *   'unknown'   — no event received yet (app just launched)
 *   'mounted'   — watch root path exists and is accessible
 *   'unmounted' — watch root path is missing (drive offline / not connected)
 */
export function useDriveStatus(): DriveStatus {
  const [status, setStatus] = useState<DriveStatus>('unknown');

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    listen<string>('drive_status', (event) => {
      const payload = event.payload;
      if (payload === 'mounted' || payload === 'unmounted') {
        setStatus(payload);
      }
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {
        // Not running inside Tauri (e.g. test environment) — ignore.
      });

    return () => {
      unlisten?.();
    };
  }, []);

  return status;
}
