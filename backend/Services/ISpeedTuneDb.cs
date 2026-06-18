using SpeedTune.Api.Models;

namespace SpeedTune.Api.Services;

/// <summary>
/// Abstraction over all data-persistence operations so the app can run with either
/// MongoDB (cloud/local) or plain JSON files (zero-dependency offline mode).
/// </summary>
public interface ISpeedTuneDb
{
    // ── Games ──────────────────────────────────────────────────────────────
    Task<List<Game>> GetAllGamesAsync();
    Task<Game?> GetGameAsync(string id);
    Task InsertGameAsync(Game game);
    Task ReplaceGameAsync(string id, Game game);
    /// <returns>true if a document was deleted, false if not found.</returns>
    Task<bool> DeleteGameAsync(string id);

    // ── Sessions ───────────────────────────────────────────────────────────
    /// <summary>Returns the most recent session that is in lobby or active status.</summary>
    Task<Session?> GetActiveSessionAsync();
    Task InsertSessionAsync(Session session);
    Task ReplaceSessionAsync(Session session);
}
