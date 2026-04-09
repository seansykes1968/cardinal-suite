/// Parallel metadata fetching for network drives.
///
/// On a local SSD, `std::fs::metadata()` returns in microseconds, so the
/// existing per-file serial approach in fswalk is fine.
///
/// On a network drive like Suite, each metadata call incurs a round-trip
/// (~5–50 ms). With 100 000 files that's 8–83 minutes of sequential waiting.
///
/// This module provides `fetch_metadata_parallel`, which fans out metadata
/// requests across a thread pool and collects the results, keeping latency
/// proportional to the slowest single batch rather than the sum of all files.

use std::{
    path::PathBuf,
    sync::Arc,
};

use rayon::prelude::*;

/// Metadata result for a single path.
#[derive(Debug)]
pub struct PathMetadata {
    pub path: PathBuf,
    pub metadata: Option<std::fs::Metadata>,
}

/// Fetch metadata for `paths` in parallel using Rayon's global thread pool.
///
/// Results are returned in the same order as `paths`.
///
/// ## Tuning
///
/// Rayon defaults to one thread per logical CPU. For network I/O that's often
/// suboptimal — network round-trips are high-latency but low-CPU. Consider
/// building a dedicated `ThreadPoolBuilder` with a higher thread count
/// (e.g. 32–64) for network drives:
///
/// ```ignore
/// let pool = rayon::ThreadPoolBuilder::new()
///     .num_threads(32)
///     .thread_name(|i| format!("cardinal-meta-{i}"))
///     .build()
///     .expect("thread pool");
/// let results = pool.install(|| fetch_metadata_parallel(&paths));
/// ```
pub fn fetch_metadata_parallel(paths: &[PathBuf]) -> Vec<PathMetadata> {
    paths
        .par_iter()
        .map(|path| PathMetadata {
            path: path.clone(),
            metadata: std::fs::symlink_metadata(path).ok(),
        })
        .collect()
}

/// Fetch metadata for `paths` in parallel, batching requests to avoid
/// overwhelming the network server with too many concurrent connections.
///
/// `batch_size` controls how many files are in-flight simultaneously.
/// A value of 64–128 tends to work well for SMB shares.
pub fn fetch_metadata_batched(paths: &[PathBuf], batch_size: usize) -> Vec<PathMetadata> {
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(batch_size.clamp(4, 128))
        .thread_name(|i| format!("cardinal-meta-{i}"))
        .build()
        .expect("metadata thread pool");

    pool.install(|| fetch_metadata_parallel(paths))
}

/// Shared, cheaply cloneable metadata result — useful when the same metadata
/// needs to be read by multiple consumers (e.g. the name index and the
/// metadata cache) without duplicating heap allocations.
pub type SharedMetadata = Arc<PathMetadata>;

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn fetches_existing_paths() {
        let paths = vec![
            PathBuf::from("/tmp"),
            PathBuf::from("/var"),
        ];
        let results = fetch_metadata_parallel(&paths);
        assert_eq!(results.len(), 2);
        assert!(results[0].metadata.is_some());
    }

    #[test]
    fn handles_missing_paths_gracefully() {
        let paths = vec![PathBuf::from("/this/does/not/exist/at/all")];
        let results = fetch_metadata_parallel(&paths);
        assert_eq!(results.len(), 1);
        assert!(results[0].metadata.is_none());
    }

    #[test]
    fn preserves_order() {
        let paths: Vec<PathBuf> = (0..10)
            .map(|i| PathBuf::from(format!("/tmp/cardinal_test_{i}")))
            .collect();
        let results = fetch_metadata_parallel(&paths);
        for (i, result) in results.iter().enumerate() {
            assert_eq!(result.path, paths[i]);
        }
    }
}
