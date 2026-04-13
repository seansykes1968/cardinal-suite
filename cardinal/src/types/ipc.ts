import type { SlabIndex } from './slab';

export type StatusBarUpdatePayload = {
  scannedFiles: number;
  processedEvents: number;
  rescanErrors: number;
};

export type IconUpdateWirePayload = {
  slabIndex: number;
  icon?: string;
};

export type IconUpdatePayload = {
  slabIndex: SlabIndex;
  icon?: string;
};

export type RecentEventPayload = {
  path: string;
  flagBits: number;
  eventId: number;
  timestamp: number;
};

export type AppLifecycleStatus = 'Initializing' | 'Updating' | 'Ready';

export type SearchResponsePayload = {
  results: number[];
  highlights?: string[];
};
/**
 * Mount state of the configured watch root (e.g. /Volumes/sn_globalserver).
 * Emitted by the Rust drive-monitor thread via the `drive_status` Tauri event.
 *
 *   'unknown'   — no event received yet
 *   'mounted'   — path exists and is accessible
 *   'unmounted' — path is missing (drive offline / not connected)
 */
export type DriveStatus = 'mounted' | 'unmounted' | 'unknown';
