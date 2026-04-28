import React, { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { useTranslation } from 'react-i18next';
import { getWatchRootValidation, isPathInputValid } from '../utils/watchRoot';
import ThemeSwitcher from './ThemeSwitcher';
import LanguageSwitcher from './LanguageSwitcher';

// "exclude" = list folders to skip.
// "include" = pick folders to scan via checkbox browser; everything else is ignored.
type FolderMode = 'exclude' | 'include';

type PreferencesOverlayProps = {
  open: boolean;
  onClose: () => void;
  sortThreshold: number;
  defaultSortThreshold: number;
  onSortThresholdChange: (value: number) => void;
  trayIconEnabled: boolean;
  onTrayIconEnabledChange: (enabled: boolean) => void;
  watchRoot: string;
  defaultWatchRoot: string;
  onWatchConfigChange: (next: { watchRoot: string; ignorePaths: string[]; scopeLabel: string }) => void;
  ignorePaths: string[];
  defaultIgnorePaths: string[];
  onReset: () => void;
  themeResetToken: number;
};

export function PreferencesOverlay({
  open,
  onClose,
  sortThreshold,
  defaultSortThreshold,
  onSortThresholdChange,
  trayIconEnabled,
  onTrayIconEnabledChange,
  watchRoot,
  defaultWatchRoot,
  onWatchConfigChange,
  ignorePaths,
  defaultIgnorePaths,
  onReset,
  themeResetToken,
}: PreferencesOverlayProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const [appVersion, setAppVersion] = useState<string>('');
  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => {});
  }, []);
  const [thresholdInput, setThresholdInput] = useState<string>(() => sortThreshold.toString());
  const [watchRootInput, setWatchRootInput] = useState<string>(() => watchRoot);

  // ---------------------------------------------------------------------------
  // Folder mode
  // ---------------------------------------------------------------------------
  const [folderMode, setFolderMode] = useState<FolderMode>('exclude');
  const [ignorePathsInput, setIgnorePathsInput] = useState<string>(() => ignorePaths.join('\n'));

  // Include mode — folder browser state
  const [folderList, setFolderList] = useState<string[]>([]);
  const [checkedFolders, setCheckedFolders] = useState<Set<string>>(new Set());
  const [browsedPath, setBrowsedPath] = useState<string>('');
  const [folderListLoading, setFolderListLoading] = useState<boolean>(false);
  const [folderListError, setFolderListError] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Load subfolder list from a given path
  // ---------------------------------------------------------------------------
  const loadFolderList = useCallback(async (path: string) => {
    setFolderListLoading(true);
    setFolderListError(null);
    try {
      const dirs = await invoke<string[]>('list_subdirectories', { path });
      setFolderList(dirs);
      setBrowsedPath(path);
      // Default: everything checked (all included)
      setCheckedFolders(new Set(dirs));
    } catch (err) {
      setFolderListError(typeof err === 'string' ? err : 'Could not read folder list.');
      setFolderList([]);
    } finally {
      setFolderListLoading(false);
    }
  }, []);

  // Auto-load when switching to include mode
  useEffect(() => {
    if (folderMode === 'include' && folderList.length === 0 && !folderListLoading) {
      loadFolderList(watchRootInput.trim() || watchRoot);
    }
  }, [folderMode, folderList.length, folderListLoading, loadFolderList, watchRootInput, watchRoot]);

  // ---------------------------------------------------------------------------
  // Read the frontmost Finder window path then load its subfolders
  // ---------------------------------------------------------------------------
  const handleReadFinderWindow = useCallback(async () => {
    setFolderListLoading(true);
    setFolderListError(null);
    try {
      const path = await invoke<string>('get_finder_window_path');
      await loadFolderList(path.trim());
    } catch (err) {
      setFolderListError(
        typeof err === 'string' ? err : 'Could not read Finder window. Is a Finder window open?',
      );
      setFolderListLoading(false);
    }
  }, [loadFolderList]);

  const handleToggleFolder = useCallback((path: string) => {
    setCheckedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    setCheckedFolders(new Set(folderList));
  }, [folderList]);

  const handleDeselectAll = useCallback(() => {
    setCheckedFolders(new Set());
  }, []);

  // ---------------------------------------------------------------------------
  // Close-on-backdrop fix: only close if mousedown AND click both landed on the
  // overlay backdrop (prevents close when dragging the textarea resize handle).
  // ---------------------------------------------------------------------------
  const mouseDownTargetRef = useRef<EventTarget | null>(null);

  const handleOverlayMouseDown = (event: React.MouseEvent<HTMLDivElement>): void => {
    mouseDownTargetRef.current = event.target;
  };

  const handleOverlayClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (
      event.target === event.currentTarget &&
      mouseDownTargetRef.current === event.currentTarget
    ) {
      onClose();
    }
  };

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
        event.preventDefault();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    setThresholdInput(sortThreshold.toString());
  }, [open, sortThreshold]);

  useEffect(() => {
    if (!open) return;
    setWatchRootInput(watchRoot);
    setIgnorePathsInput(ignorePaths.join('\n'));
  }, [open, watchRoot, ignorePaths]);

  // ---------------------------------------------------------------------------
  // Threshold
  // ---------------------------------------------------------------------------
  const commitThreshold = useCallback(() => {
    const numericText = thresholdInput.replace(/[^\d]/g, '');
    if (!numericText) {
      setThresholdInput(sortThreshold.toString());
      return;
    }
    const parsed = Number.parseInt(numericText, 10);
    if (Number.isNaN(parsed)) {
      setThresholdInput(sortThreshold.toString());
      return;
    }
    const normalized = Math.max(1, Math.round(parsed));
    onSortThresholdChange(normalized);
    setThresholdInput(normalized.toString());
  }, [onSortThresholdChange, sortThreshold, thresholdInput]);

  const handleThresholdChange = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const value = event.target.value;
    if (/^\d*$/.test(value)) {
      setThresholdInput(value);
    }
  };

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------
  const { errorKey: watchRootErrorKey } = getWatchRootValidation(watchRootInput);
  const watchRootErrorMessage = watchRootErrorKey ? t(watchRootErrorKey) : null;

  const handleWatchRootKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') setWatchRootInput(watchRoot);
  };

  const parsedIgnorePaths = ignorePathsInput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const ignorePathsErrorMessage = (() => {
    if (folderMode === 'include') return null;
    const invalid = parsedIgnorePaths.find((line) => !isPathInputValid(line));
    return invalid ? t('ignorePaths.errors.absolute') : null;
  })();

  const includeSelectionError =
    folderMode === 'include' && folderList.length > 0 && checkedFolders.size === 0
      ? 'Select at least one folder to scan.'
      : null;

  const handleIgnorePathsKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Escape') setIgnorePathsInput(ignorePaths.join('\n'));
  };

  // ---------------------------------------------------------------------------
  // Save
  // ---------------------------------------------------------------------------
  const handleSave = useCallback((): void => {
    if (watchRootErrorMessage || ignorePathsErrorMessage || includeSelectionError) return;
    commitThreshold();

    const trimmedWatchRoot = watchRootInput.trim();

    let finalWatchRoot: string;
    let finalIgnorePaths: string[];

    if (folderMode === 'include') {
      // Use the browsed path as the new watch root so Cardinal only scans
      // within that folder. Unchecked items become the ignore list.
      finalWatchRoot = browsedPath || trimmedWatchRoot;
      finalIgnorePaths = folderList.filter((f) => !checkedFolders.has(f));
    } else {
      finalWatchRoot = trimmedWatchRoot;
      finalIgnorePaths = parsedIgnorePaths;
    }

    // Compute a human-readable scope label for the status bar.
    let scopeLabel: string;
    if (folderMode === 'include' && checkedFolders.size > 0) {
      if (checkedFolders.size === 1) {
        const only = [...checkedFolders][0];
        scopeLabel = only.split('/').filter(Boolean).pop() ?? only;
      } else {
        scopeLabel = `${checkedFolders.size} folders`;
      }
    } else {
      scopeLabel = finalWatchRoot.split('/').filter(Boolean).pop() ?? finalWatchRoot;
    }

    onWatchConfigChange({ watchRoot: finalWatchRoot, ignorePaths: finalIgnorePaths, scopeLabel });
    setWatchRootInput(finalWatchRoot);
    setIgnorePathsInput(finalIgnorePaths.join('\n'));
    onClose();
  }, [
    watchRootErrorMessage,
    ignorePathsErrorMessage,
    includeSelectionError,
    commitThreshold,
    watchRootInput,
    folderMode,
    browsedPath,
    folderList,
    checkedFolders,
    parsedIgnorePaths,
    onWatchConfigChange,
    onClose,
  ]);

  // ---------------------------------------------------------------------------
  // Reset
  // ---------------------------------------------------------------------------
  const handleReset = (): void => {
    setThresholdInput(defaultSortThreshold.toString());
    setWatchRootInput(defaultWatchRoot);
    setIgnorePathsInput(defaultIgnorePaths.join('\n'));
    setFolderList([]);
    setCheckedFolders(new Set());
    setBrowsedPath('');
    setFolderMode('exclude');
    onReset();
  };

  if (!open) return null;

  const saveDisabled = Boolean(
    watchRootErrorMessage || ignorePathsErrorMessage || includeSelectionError,
  );

  // Display just the folder name, not the full path, in the checkbox list
  const folderDisplayName = (fullPath: string): string =>
    fullPath.split('/').filter(Boolean).pop() ?? fullPath;

  return (
    <div
      className="preferences-overlay"
      role="dialog"
      aria-modal="true"
      onMouseDown={handleOverlayMouseDown}
      onClick={handleOverlayClick}
    >
      <div className="preferences-card">
        <header className="preferences-card__header">
          <h1 className="preferences-card__title">{t('preferences.title')}</h1>
        </header>

        <div className="preferences-section">
          {/* Appearance */}
          <div className="preferences-row">
            <p className="preferences-label">{t('preferences.appearance')}</p>
            <ThemeSwitcher className="preferences-control" resetToken={themeResetToken} />
          </div>

          {/* Language */}
          <div className="preferences-row">
            <p className="preferences-label">{t('preferences.language')}</p>
            <LanguageSwitcher className="preferences-control" />
          </div>

          {/* Tray icon */}
          <div className="preferences-row">
            <p className="preferences-label">{t('preferences.trayIcon.label')}</p>
            <div className="preferences-control">
              <label className="preferences-switch">
                <input
                  className="preferences-switch__input"
                  type="checkbox"
                  checked={trayIconEnabled}
                  onChange={(event) => onTrayIconEnabledChange(event.target.checked)}
                  aria-label={t('preferences.trayIcon.label')}
                />
                <span className="preferences-switch__track" aria-hidden="true" />
              </label>
            </div>
          </div>

          {/* Sorting limit */}
          <div className="preferences-row">
            <div className="preferences-row__details">
              <p className="preferences-label">{t('preferences.sortingLimit.label')}</p>
            </div>
            <div className="preferences-control">
              <input
                className="preferences-field preferences-number-input"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={thresholdInput}
                onChange={handleThresholdChange}
                aria-label={t('preferences.sortingLimit.label')}
              />
            </div>
          </div>

          {/* Watch root */}
          <div className="preferences-row">
            <div className="preferences-row__details">
              <p className="preferences-label" title={t('watchRoot.help')}>
                {t('watchRoot.label')}
              </p>
            </div>
            <div className="preferences-control">
              <input
                className="preferences-field preferences-number-input preferences-watch-root-input"
                type="text"
                value={watchRootInput}
                onChange={(event) => setWatchRootInput(event.target.value)}
                onKeyDown={handleWatchRootKeyDown}
                aria-label={t('watchRoot.label')}
                autoComplete="off"
                spellCheck={false}
              />
              {watchRootErrorMessage ? (
                <p
                  className="permission-status permission-status--error preferences-field-error"
                  role="status"
                  aria-live="polite"
                >
                  {watchRootErrorMessage}
                </p>
              ) : null}
            </div>
          </div>

          {/* Folder mode toggle */}
          <div className="preferences-row">
            <div className="preferences-row__details">
              <p className="preferences-label">Folder mode</p>
            </div>
            <div
              className="preferences-control preferences-folder-mode"
              style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
            >
              <label
                className="preferences-folder-mode__option"
                style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}
              >
                <input
                  type="radio"
                  name="folderMode"
                  value="include"
                  checked={folderMode === 'include'}
                  onChange={() => setFolderMode('include')}
                />
                <span>Search only these folders</span>
              </label>
              <label
                className="preferences-folder-mode__option"
                style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}
              >
                <input
                  type="radio"
                  name="folderMode"
                  value="exclude"
                  checked={folderMode === 'exclude'}
                  onChange={() => setFolderMode('exclude')}
                />
                <span>Exclude these folders</span>
              </label>
            </div>
          </div>

          {/* Include mode — folder browser */}
          {folderMode === 'include' && (
            <div className="preferences-row" style={{ alignItems: 'flex-start' }}>
              <div className="preferences-row__details">
                <p className="preferences-label">Search folders</p>
                <p className="preferences-label-hint">
                  Check the folders you want to scan.
                </p>
              </div>
              <div className="preferences-control" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {/* Browsed path + Finder button */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span
                    style={{
                      flex: 1,
                      fontSize: '0.75em',
                      color: 'var(--color-text-secondary, #888)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={browsedPath}
                  >
                    {browsedPath || watchRootInput}
                  </span>
                  <button
                    type="button"
                    className="preferences-save"
                    style={{ padding: '2px 10px', fontSize: '0.8em', whiteSpace: 'nowrap' }}
                    onClick={handleReadFinderWindow}
                    disabled={folderListLoading}
                    title="Read folders from the frontmost Finder window"
                  >
                    {folderListLoading ? 'Loading…' : 'Read Finder window'}
                  </button>
                </div>

                {/* Error */}
                {folderListError && (
                  <p
                    className="permission-status permission-status--error preferences-field-error"
                    role="status"
                    aria-live="polite"
                  >
                    {folderListError}
                  </p>
                )}

                {/* Select all / none */}
                {folderList.length > 0 && (
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      onClick={handleSelectAll}
                      style={{
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        fontSize: '0.75em',
                        color: 'var(--color-accent, #0066cc)',
                        cursor: 'pointer',
                        textDecoration: 'underline',
                      }}
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      onClick={handleDeselectAll}
                      style={{
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        fontSize: '0.75em',
                        color: 'var(--color-accent, #0066cc)',
                        cursor: 'pointer',
                        textDecoration: 'underline',
                      }}
                    >
                      Deselect all
                    </button>
                  </div>
                )}

                {/* Checkbox list */}
                {folderList.length > 0 && (
                  <div
                    style={{
                      maxHeight: '200px',
                      overflowY: 'auto',
                      border: '1px solid var(--color-border, #ddd)',
                      borderRadius: '6px',
                      padding: '4px 0',
                    }}
                  >
                    {folderList.map((folder) => (
                      <label
                        key={folder}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '4px 10px',
                          cursor: 'pointer',
                          fontSize: '0.85em',
                        }}
                        title={folder}
                      >
                        <input
                          type="checkbox"
                          checked={checkedFolders.has(folder)}
                          onChange={() => handleToggleFolder(folder)}
                        />
                        <span
                          style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {folderDisplayName(folder)}
                        </span>
                      </label>
                    ))}
                  </div>
                )}

                {/* No folders found */}
                {!folderListLoading && folderList.length === 0 && !folderListError && (
                  <p style={{ fontSize: '0.8em', color: 'var(--color-text-secondary, #888)' }}>
                    No subfolders found. Try "Read Finder window" to browse a different location.
                  </p>
                )}

                {/* Selection validation */}
                {includeSelectionError && (
                  <p
                    className="permission-status permission-status--error preferences-field-error"
                    role="status"
                    aria-live="polite"
                  >
                    {includeSelectionError}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Exclude mode — ignore paths textarea */}
          {folderMode === 'exclude' && (
            <div className="preferences-row">
              <div className="preferences-row__details">
                <p className="preferences-label">{t('ignorePaths.label')}</p>
                <p className="preferences-label-hint">
                  One folder per line. These folders will be skipped.
                </p>
              </div>
              <div className="preferences-control">
                <textarea
                  className="preferences-field preferences-textarea"
                  value={ignorePathsInput}
                  onChange={(event) => setIgnorePathsInput(event.target.value)}
                  onKeyDown={handleIgnorePathsKeyDown}
                  aria-label={t('ignorePaths.label')}
                  autoComplete="off"
                  spellCheck={false}
                />
                {ignorePathsErrorMessage ? (
                  <p
                    className="permission-status permission-status--error preferences-field-error"
                    role="status"
                    aria-live="polite"
                  >
                    {ignorePathsErrorMessage}
                  </p>
                ) : null}
              </div>
            </div>
          )}
        </div>

        <footer className="preferences-card__footer">
          <button
            className="preferences-save"
            type="button"
            onClick={handleSave}
            disabled={saveDisabled}
          >
            {t('preferences.save')}
          </button>
          <button className="preferences-reset" type="button" onClick={handleReset}>
            {t('preferences.reset')}
          </button>
          {appVersion && (
            <span style={{ marginLeft: 'auto', fontSize: '11px', opacity: 0.4, alignSelf: 'center' }}>
              v{appVersion}
            </span>
          )}
        </footer>
      </div>
    </div>
  );
}

export default PreferencesOverlay;
