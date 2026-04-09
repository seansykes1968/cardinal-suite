/// Network and file-type guards for search operations.
///
/// When searching a network drive (such as Suite), certain operations that are
/// fast on a local SSD become prohibitively slow or cause side-effects:
///
/// - Content search opens every matching file in 64 KB chunks over the network.
/// - Opening large binary files (Illustrator, Photoshop) while those apps have
///   them open can interfere with advisory locks and block saves.
///
/// This module provides cheap guards to short-circuit those operations.

use std::path::Path;

// ---------------------------------------------------------------------------
// Network volume detection
// ---------------------------------------------------------------------------

/// Returns `true` if `path` is likely located on a network (remote) volume.
///
/// On macOS, network drives (SMB, AFP, NFS etc.) are almost always mounted
/// under `/Volumes/`. This is a fast, zero-syscall check that covers the
/// vast majority of real-world network drive configurations including Suite.
///
/// Falls back to `false` (safe default) for any path that doesn't match,
/// meaning local files are never incorrectly treated as network files.
pub fn is_network_path(path: &Path) -> bool {
    path.starts_with("/Volumes/")
}

// ---------------------------------------------------------------------------
// File-type guards for content search
// ---------------------------------------------------------------------------

/// Extensions of binary/creative formats that should be **skipped** during
/// content search unless the user explicitly opts in with `content:`.
///
/// Rationale:
/// - These files are large opaque binaries; text search rarely returns
///   meaningful results and is very slow over a network drive.
/// - Applications like Adobe Illustrator and Photoshop use advisory locks
///   during saves. A long-lived file handle held by Cardinal's content
///   search loop can race with those locks and cause the app to fail to save.
///
/// Add formats here freely — the check is a simple string comparison.
const SKIP_CONTENT_EXTENSIONS: &[&str] = &[
    // Adobe
    "ai", "psd", "psb", "indd", "indb", "aep", "prproj",
    // Other creative
    "sketch", "fig", "xd", "afdesign", "afphoto",
    // Video / audio
    "mov", "mp4", "m4v", "avi", "mkv", "mp3", "wav", "aiff",
    // Archives
    "zip", "gz", "tar", "rar", "7z", "dmg", "pkg",
    // Compiled / binary
    "o", "a", "dylib", "so", "exe", "bin",
    // Images
    "tiff", "tif", "raw", "cr2", "nef", "arw", "heic",
    // Fonts
    "otf", "ttf", "woff", "woff2",
    // Office (large binary formats)
    "xlsx", "docx", "pptx",
];

/// Returns `true` if the file at `path` should be **excluded** from content
/// search based on its extension.
///
/// This is intentionally conservative: if the extension is unknown or absent,
/// we return `false` (allow searching).
pub fn should_skip_content_search(path: &Path) -> bool {
    let Some(ext) = path.extension().and_then(|e| e.to_str()) else {
        return false;
    };
    SKIP_CONTENT_EXTENSIONS
        .iter()
        .any(|&skip| ext.eq_ignore_ascii_case(skip))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn illustrator_files_are_skipped() {
        assert!(should_skip_content_search(Path::new("logo.ai")));
        assert!(should_skip_content_search(Path::new("design.AI")));
        assert!(should_skip_content_search(Path::new("photo.psd")));
    }

    #[test]
    fn text_files_are_not_skipped() {
        assert!(!should_skip_content_search(Path::new("readme.txt")));
        assert!(!should_skip_content_search(Path::new("main.rs")));
        assert!(!should_skip_content_search(Path::new("notes.md")));
    }

    #[test]
    fn files_without_extension_are_not_skipped() {
        assert!(!should_skip_content_search(Path::new("Makefile")));
        assert!(!should_skip_content_search(Path::new("LICENSE")));
    }

    #[test]
    fn volumes_path_is_network() {
        assert!(is_network_path(Path::new("/Volumes/SuiteDrive/project.ai")));
        assert!(is_network_path(Path::new("/Volumes/MyServer/file.txt")));
    }

    #[test]
    fn local_path_is_not_network() {
        assert!(!is_network_path(Path::new("/Users/sean/Documents/file.txt")));
        assert!(!is_network_path(Path::new("/tmp/cache")));
    }
}
