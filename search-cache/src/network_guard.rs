/// Network and file-type guards for search operations.
///
/// When searching a network drive (such as Suite), certain operations that are
/// fast on a local SSD become prohibitively slow or cause side-effects:
///
/// - Content search opens every matching file in 64 KB chunks over the network.
/// - Metadata reads incur per-file round-trip latency.
/// - Opening large binary files (Illustrator, Photoshop) while those apps have
///   them open can interfere with advisory locks and block saves.
///
/// This module provides cheap guards to short-circuit those operations.

use std::ffi::CString;
use std::path::Path;

// ---------------------------------------------------------------------------
// Network volume detection
// ---------------------------------------------------------------------------

/// File-system types that indicate a remote/network mount.
/// Extend this list as needed (e.g. "nfs", "afpfs", "smbfs", "webdav").
const NETWORK_FS_TYPES: &[&str] = &["smbfs", "afpfs", "nfs", "webdav", "ftpfs", "osxfuse"];

/// Returns `true` if `path` is located on a network (remote) volume.
///
/// Uses `statfs(2)` under the hood — one syscall, no file opens.
/// Falls back to `false` (safe default) if the call fails.
#[cfg(target_os = "macos")]
pub fn is_network_path(path: &Path) -> bool {
    use std::mem::MaybeUninit;

    let Ok(cpath) = path_to_cstring(path) else {
        return false;
    };

    // SAFETY: `statfs` is a standard POSIX call. We pass a valid C string and a
    // properly aligned, zeroed output buffer.
    let mut buf: MaybeUninit<libc::statfs> = MaybeUninit::zeroed();
    let ret = unsafe { libc::statfs(cpath.as_ptr(), buf.as_mut_ptr()) };
    if ret != 0 {
        return false;
    }
    let stat = unsafe { buf.assume_init() };

    // `f_fstypename` is a null-terminated C string of at most 16 bytes.
    let type_bytes = stat.f_fstypename.map(|b| b as u8);
    let type_str = std::str::from_utf8(
        &type_bytes[..type_bytes.iter().position(|&b| b == 0).unwrap_or(type_bytes.len())],
    )
    .unwrap_or("");

    NETWORK_FS_TYPES
        .iter()
        .any(|&t| type_str.eq_ignore_ascii_case(t))
}

#[cfg(not(target_os = "macos"))]
pub fn is_network_path(_path: &Path) -> bool {
    false
}

fn path_to_cstring(path: &Path) -> Result<CString, std::ffi::NulError> {
    use std::os::unix::ffi::OsStrExt;
    CString::new(path.as_os_str().as_bytes())
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
/// - Applications like Adobe Illustrator and Photoshop use advisory `flock()`
///   during saves. A long-lived `O_RDONLY` handle held by Cardinal's content
///   search loop can race with those locks and cause the app to fail to save.
///
/// Add formats here freely — the check is a single hash-set lookup.
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
    use std::path::PathBuf;

    #[test]
    fn illustrator_files_are_skipped() {
        assert!(should_skip_content_search(Path::new("logo.ai")));
        assert!(should_skip_content_search(Path::new("design.AI"))); // case-insensitive
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
}
