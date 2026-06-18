using System.Text.Json;
using System.Text.Json.Serialization;
using SpeedTune.Api.Models;

namespace SpeedTune.Api.Services;

/// <summary>
/// ISpeedTuneDb backed by plain JSON files — no external database required.
/// Games are persisted to  data/games.json
/// Sessions are persisted to data/sessions.json
/// Both files live in the backend content-root/data/ folder.
/// </summary>
public class LocalSpeedTuneDb : ISpeedTuneDb
{
    private readonly string _gamesFile;
    private readonly string _sessionsFile;
    private readonly SemaphoreSlim _gamesLock   = new(1, 1);
    private readonly SemaphoreSlim _sessionsLock = new(1, 1);

    private static readonly JsonSerializerOptions _json = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = null,   // keep PascalCase to match the rest of the app
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public LocalSpeedTuneDb(IWebHostEnvironment env)
    {
        var dataDir = Path.Combine(env.ContentRootPath, "data");
        Directory.CreateDirectory(dataDir);
        _gamesFile    = Path.Combine(dataDir, "games.json");
        _sessionsFile = Path.Combine(dataDir, "sessions.json");
    }

    // ── Games ──────────────────────────────────────────────────────────────

    public async Task<List<Game>> GetAllGamesAsync()
    {
        await _gamesLock.WaitAsync();
        try   { return (await ReadGames()).OrderByDescending(g => g.CreatedAt).ToList(); }
        finally { _gamesLock.Release(); }
    }

    public async Task<Game?> GetGameAsync(string id)
    {
        await _gamesLock.WaitAsync();
        try   { return (await ReadGames()).FirstOrDefault(g => g.Id == id); }
        finally { _gamesLock.Release(); }
    }

    public async Task InsertGameAsync(Game game)
    {
        await _gamesLock.WaitAsync();
        try
        {
            var games = await ReadGames();
            games.Add(game);
            await WriteGames(games);
        }
        finally { _gamesLock.Release(); }
    }

    public async Task ReplaceGameAsync(string id, Game game)
    {
        await _gamesLock.WaitAsync();
        try
        {
            var games = await ReadGames();
            var idx   = games.FindIndex(g => g.Id == id);
            if (idx >= 0) games[idx] = game;
            else          games.Add(game);
            await WriteGames(games);
        }
        finally { _gamesLock.Release(); }
    }

    public async Task<bool> DeleteGameAsync(string id)
    {
        await _gamesLock.WaitAsync();
        try
        {
            var games   = await ReadGames();
            var removed = games.RemoveAll(g => g.Id == id);
            if (removed > 0) await WriteGames(games);
            return removed > 0;
        }
        finally { _gamesLock.Release(); }
    }

    // ── Sessions ───────────────────────────────────────────────────────────

    public async Task<Session?> GetActiveSessionAsync()
    {
        await _sessionsLock.WaitAsync();
        try
        {
            return (await ReadSessions())
                .Where(s => s.Status == "lobby" || s.Status == "active")
                .OrderByDescending(s => s.CreatedAt)
                .FirstOrDefault();
        }
        finally { _sessionsLock.Release(); }
    }

    public async Task InsertSessionAsync(Session session)
    {
        await _sessionsLock.WaitAsync();
        try
        {
            var sessions = await ReadSessions();
            sessions.Add(session);
            await WriteSessions(sessions);
        }
        finally { _sessionsLock.Release(); }
    }

    public async Task ReplaceSessionAsync(Session session)
    {
        await _sessionsLock.WaitAsync();
        try
        {
            var sessions = await ReadSessions();
            var idx      = sessions.FindIndex(s => s.Id == session.Id);
            if (idx >= 0) sessions[idx] = session;
            else          sessions.Add(session);
            await WriteSessions(sessions);
        }
        finally { _sessionsLock.Release(); }
    }

    // ── Private helpers ────────────────────────────────────────────────────

    private async Task<List<Game>> ReadGames()
    {
        if (!File.Exists(_gamesFile)) return [];
        var json = await File.ReadAllTextAsync(_gamesFile);
        return JsonSerializer.Deserialize<List<Game>>(json, _json) ?? [];
    }

    private Task WriteGames(List<Game> games) =>
        File.WriteAllTextAsync(_gamesFile, JsonSerializer.Serialize(games, _json));

    private async Task<List<Session>> ReadSessions()
    {
        if (!File.Exists(_sessionsFile)) return [];
        var json = await File.ReadAllTextAsync(_sessionsFile);
        return JsonSerializer.Deserialize<List<Session>>(json, _json) ?? [];
    }

    private Task WriteSessions(List<Session> sessions) =>
        File.WriteAllTextAsync(_sessionsFile, JsonSerializer.Serialize(sessions, _json));
}
