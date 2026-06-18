using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using SpeedTune.Api.Models;

namespace SpeedTune.Api.Services;

/// <summary>Snapshot of a game's offline-cache download progress.</summary>
public class GameDownloadStatus
{
    private int _downloaded;
    private int _failed;

    public int Total { get; set; }
    public int Downloaded => _downloaded;
    public int Failed => _failed;
    public bool IsRunning { get; set; }
    public bool IsDone { get; set; }

    internal void IncrementDownloaded() => Interlocked.Increment(ref _downloaded);
    internal void IncrementFailed()     => Interlocked.Increment(ref _failed);
}

/// <summary>
/// Singleton service that downloads song media files from the CDN to the local
/// wwwroot/media-cache folder and keeps track of download progress per game.
/// </summary>
public class OfflineMediaService(
    ISpeedTuneDb db,
    IHttpClientFactory httpClientFactory,
    IWebHostEnvironment env)
{
    private readonly ConcurrentDictionary<string, GameDownloadStatus> _progress = new();

    // WebRootPath is null when wwwroot doesn't exist yet; fall back to ContentRoot/wwwroot
    private string WebRoot => env.WebRootPath
        ?? Path.Combine(env.ContentRootPath, "wwwroot");

    // ── Public API ─────────────────────────────────────────────────────────

    /// <summary>Returns current download status for the game, or null if never started.</summary>
    public GameDownloadStatus? GetStatus(string gameId) =>
        _progress.TryGetValue(gameId, out var s) ? s : null;

    /// <summary>
    /// Kicks off a background download for all songs in the game.
    /// Returns false if already running or game not found.
    /// </summary>
    public async Task<bool> StartDownload(string gameId)
    {
        if (_progress.TryGetValue(gameId, out var existing) && existing.IsRunning)
            return false;

        var game = await db.GetGameAsync(gameId);
        if (game is null) return false;

        var allSongs = game.Cards.SelectMany(c => c.Songs).ToList();
        var state = new GameDownloadStatus { Total = allSongs.Count, IsRunning = true };
        _progress[gameId] = state;

        // Fire-and-forget; progress is polled via GetStatus
        _ = Task.Run(() => DownloadAllAsync(gameId, game, state));
        return true;
    }

    /// <summary>
    /// Deletes all locally cached files for the game and clears LocalVideoUrl on every song.
    /// </summary>
    public async Task DeleteCache(string gameId)
    {
        var game = await db.GetGameAsync(gameId);
        if (game is null) return;

        foreach (var song in game.Cards.SelectMany(c => c.Songs))
        {
            if (string.IsNullOrEmpty(song.LocalVideoUrl)) continue;
            var filePath = LocalUrlToPath(song.LocalVideoUrl);
            if (File.Exists(filePath)) File.Delete(filePath);
            song.LocalVideoUrl = null;
        }

        game.IsLocalized = false;
        game.UpdatedAt = DateTime.UtcNow;
        await db.ReplaceGameAsync(gameId, game);
        _progress.TryRemove(gameId, out _);
    }

    // ── Private helpers ────────────────────────────────────────────────────

    private async Task DownloadAllAsync(string gameId, Game game, GameDownloadStatus state)
    {
        var mediaDir = Path.Combine(WebRoot, "media-cache");
        Directory.CreateDirectory(mediaDir);

        var sem = new SemaphoreSlim(5);
        var tasks = new List<Task>();

        foreach (var song in game.Cards.SelectMany(c => c.Songs))
        {
            var capturedSong = song;
            await sem.WaitAsync();
            tasks.Add(Task.Run(async () =>
            {
                try
                {
                    await DownloadSongAsync(capturedSong, mediaDir);
                    state.IncrementDownloaded();
                }
                catch
                {
                    state.IncrementFailed();
                }
                finally
                {
                    sem.Release();
                }
            }));
        }

        await Task.WhenAll(tasks);

        // Update the game in the database with LocalVideoUrl set on each song
        game.IsLocalized = state.Failed == 0;
        game.UpdatedAt = DateTime.UtcNow;
        await db.ReplaceGameAsync(gameId, game);

        state.IsRunning = false;
        state.IsDone = true;
    }

    private async Task DownloadSongAsync(SongEntry song, string mediaDir)
    {
        if (string.IsNullOrWhiteSpace(song.VideoUrl)) return;

        // Build a deterministic local filename from a hash of the URL
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(song.VideoUrl)))[..16];
        var ext  = Path.GetExtension(new Uri(song.VideoUrl).LocalPath);
        if (string.IsNullOrEmpty(ext)) ext = ".mp4";
        var filename  = hash + ext;
        var localPath = Path.Combine(mediaDir, filename);

        // Skip download if file already exists
        if (!File.Exists(localPath))
        {
            using var client = httpClientFactory.CreateClient();
            client.Timeout = TimeSpan.FromMinutes(5);
            var bytes = await client.GetByteArrayAsync(song.VideoUrl);
            await File.WriteAllBytesAsync(localPath, bytes);
        }

        song.LocalVideoUrl = $"/media-cache/{filename}";
    }

    private string LocalUrlToPath(string localUrl) =>
        Path.Combine(WebRoot, localUrl.TrimStart('/').Replace('/', Path.DirectorySeparatorChar));
}
