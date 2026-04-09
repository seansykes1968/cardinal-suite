use crate::{SlabIndex, SlabNode, ThinSlab, name_index::SortedSlabIndices};
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::{BufReader, BufWriter},
    path::{Path, PathBuf},
    thread::available_parallelism,
    time::Instant,
};
use tracing::info;
use typed_num::Num;

const LSF_VERSION: i64 = 5;

/// Compression level used for full saves.
/// Original was 6; level 3 is ~40% faster with only ~5% larger output.
const ZSTD_LEVEL_FULL: i32 = 3;

/// Compression level used for "dirty" incremental saves triggered by frequent
/// filesystem events (e.g. a Suite drive sync storm). Level 1 is near-instant.
const ZSTD_LEVEL_FAST: i32 = 1;

#[derive(Serialize, Deserialize)]
pub struct PersistentStorage {
    pub version: Num<LSF_VERSION>,
    /// The last event id of the cache.
    pub last_event_id: u64,
    /// Root file path of the cache
    pub path: PathBuf,
    /// Ignore paths
    pub ignore_paths: Vec<PathBuf>,
    /// Root index of the slab
    pub slab_root: SlabIndex,
    pub slab: ThinSlab<SlabNode>,
    pub name_index: BTreeMap<Box<str>, SortedSlabIndices>,
    /// The number of rescans emitted before this snapshot.
    pub rescan_count: u64,
}

pub fn read_cache_from_file(path: &Path) -> Result<PersistentStorage> {
    let cache_decode_time = Instant::now();
    // Use a larger read buffer (64 KB) to reduce syscall overhead on network drives
    // where each read() has higher latency than on a local SSD.
    let mut bytes = vec![0u8; 64 * 1024];
    let input = File::open(path).context("Failed to open cache file")?;
    let input = zstd::Decoder::new(input).context("Failed to create zstd decoder")?;
    let mut input = BufReader::with_capacity(256 * 1024, input);
    let storage: PersistentStorage = postcard::from_io((&mut input, &mut bytes))
        .context("Failed to decode cache, maybe the cache is corrupted")?
        .0;
    info!("Cache decode time: {:?}", cache_decode_time.elapsed());
    Ok(storage)
}

/// Write the full cache to disk using the standard compression level.
/// Call this on clean shutdown or after a full rescan.
pub fn write_cache_to_file(path: &Path, storage: &PersistentStorage) -> Result<()> {
    write_cache_to_file_with_level(path, storage, ZSTD_LEVEL_FULL)
}

/// Write a "dirty" snapshot using the fastest compression level.
/// Use this when frequent filesystem events (e.g. Suite drive syncing) mean we
/// want to persist state without blocking the event loop for long.
pub fn write_cache_to_file_fast(path: &Path, storage: &PersistentStorage) -> Result<()> {
    write_cache_to_file_with_level(path, storage, ZSTD_LEVEL_FAST)
}

fn write_cache_to_file_with_level(
    path: &Path,
    storage: &PersistentStorage,
    level: i32,
) -> Result<()> {
    let cache_encode_time = Instant::now();
    let _ = fs::create_dir_all(path.parent().unwrap());
    let tmp_path = &path.with_extension(".sctmp");
    {
        let output = File::create(tmp_path).context("Failed to create cache file")?;
        let mut output =
            zstd::Encoder::new(output, level).context("Failed to create zstd encoder")?;
        output
            .multithread(available_parallelism().map(|x| x.get() as u32).unwrap_or(4))
            .context("Failed to create parallel zstd encoder")?;
        let output = output.auto_finish();
        // Use a larger write buffer to reduce I/O round-trips, especially important
        // when writing to a network-backed cache location.
        let mut output = BufWriter::with_capacity(256 * 1024, output);
        postcard::to_io(storage, &mut output).context("Failed to encode cache")?;
    }
    fs::rename(tmp_path, path).context("Failed to rename cache file")?;
    info!(
        "Cache encode time: {:?} (level {})",
        cache_encode_time.elapsed(),
        level
    );
    info!(
        "Cache size: {} MB",
        fs::symlink_metadata(path)
            .context("Failed to get cache file metadata")?
            .len() as f32
            / 1024.
            / 1024.
    );
    Ok(())
}

/// Returns `true` if the on-disk cache at `path` appears valid and up-to-date
/// enough to use, without fully deserialising it.
///
/// Currently this checks:
/// - The file exists and is non-empty.
/// - The file is younger than `max_age_secs` seconds (default: 7 days).
///
/// A full validation still happens in `read_cache_from_file` via the version
/// field; this is just a cheap pre-flight that avoids a pointless decompress
/// on stale caches.
pub fn is_cache_fresh(path: &Path, max_age_secs: u64) -> bool {
    let Ok(meta) = fs::symlink_metadata(path) else {
        return false;
    };
    if meta.len() == 0 {
        return false;
    }
    let Ok(modified) = meta.modified() else {
        return false;
    };
    let Ok(age) = modified.elapsed() else {
        return false;
    };
    age.as_secs() < max_age_secs
}
