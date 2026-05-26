using Microsoft.AspNetCore.SignalR;
using MongoDB.Driver;
using SpeedTune.Api.Models;
using SpeedTune.Api.Services;

namespace SpeedTune.Api.Hubs;

public class GameHub(GameEngineService engine, MongoDbService db, RoomTracker tracker) : Hub
{
    // ── helpers ────────────────────────────────────────────────────────────

    private string? SessionId => tracker.GetSessionId(Context.ConnectionId);
    private bool IsHost => tracker.IsHostConnection(Context.ConnectionId);

    // ── player ─────────────────────────────────────────────────────────────

    /// <summary>
    /// Called by each player browser on page load.
    /// Finds the session by room code, adds to player + room groups.
    /// </summary>
    public async Task PlayerJoin(string name, string color, string roomCode)
    {
        var session = await db.Sessions
            .Find(s => s.RoomCode == roomCode && (s.Status == "lobby" || s.Status == "active"))
            .FirstOrDefaultAsync();

        if (session is null)
        {
            await Clients.Caller.SendAsync("Error", new { Message = "Room not found" });
            return;
        }

        await Groups.AddToGroupAsync(Context.ConnectionId, $"players-{session.Id}");
        await Groups.AddToGroupAsync(Context.ConnectionId, $"room-{session.Id}");
        tracker.Track(Context.ConnectionId, session.Id, isHost: false);

        await engine.PlayerJoin(Context.ConnectionId, name, color, session.Id);
    }

    // ── display screen ─────────────────────────────────────────────────────

    /// <summary>
    /// Called by the public display screen. Finds session by room code.
    /// </summary>
    public async Task DisplayJoin(string roomCode)
    {
        var session = await db.Sessions
            .Find(s => s.RoomCode == roomCode && (s.Status == "lobby" || s.Status == "active"))
            .FirstOrDefaultAsync();

        if (session is null)
        {
            await Clients.Caller.SendAsync("Error", new { Message = "Room not found" });
            return;
        }

        await Groups.AddToGroupAsync(Context.ConnectionId, $"display-{session.Id}");
        await Groups.AddToGroupAsync(Context.ConnectionId, $"room-{session.Id}");
        tracker.Track(Context.ConnectionId, session.Id, isHost: false);

        await SendCallerState(session.Id);
    }

    // ── host ────────────────────────────────────────────────────────────────

    /// <summary>
    /// Called by the host control panel with a session-specific host token.
    /// No JWT required — token validates authority over the specific session.
    /// </summary>
    public async Task HostJoin(string sessionId, string hostToken)
    {
        var session = await db.Sessions.Find(s => s.Id == sessionId).FirstOrDefaultAsync();

        if (session is null || session.HostToken != hostToken)
        {
            await Clients.Caller.SendAsync("Error", new { Message = "Unauthorized" });
            return;
        }

        await Groups.AddToGroupAsync(Context.ConnectionId, $"host-{session.Id}");
        await Groups.AddToGroupAsync(Context.ConnectionId, $"room-{session.Id}");
        tracker.Track(Context.ConnectionId, session.Id, isHost: true);

        await SendCallerState(session.Id);
    }

    public async Task HostStartGame()
    {
        if (!IsHost || SessionId is null) return;
        await engine.StartGame(SessionId);
    }

    public async Task HostOpenCard(string cardId)
    {
        if (!IsHost || SessionId is null) return;
        await engine.OpenCard(SessionId, cardId);
    }

    public async Task HostJudge(bool correct)
    {
        if (!IsHost || SessionId is null) return;
        await engine.Judge(SessionId, correct);
    }

    public async Task HostSkip()
    {
        if (!IsHost || SessionId is null) return;
        await engine.Skip(SessionId);
    }

    public async Task HostNextSong()
    {
        if (!IsHost || SessionId is null) return;
        await engine.NextSong(SessionId);
    }

    public async Task HostPauseAudio()
    {
        if (!IsHost || SessionId is null) return;
        await Clients.Group($"display-{SessionId}").SendAsync("RoundAudioPause");
    }

    public async Task HostResumeAudio()
    {
        if (!IsHost || SessionId is null) return;
        await Clients.Group($"display-{SessionId}").SendAsync("RoundAudioPlay");
    }

    public async Task HostKickPlayer(string playerId)
    {
        if (!IsHost || SessionId is null) return;
        await engine.KickPlayer(SessionId, playerId);
    }

    public async Task HostEndGame()
    {
        if (!IsHost || SessionId is null) return;
        await engine.EndGame(SessionId);
    }

    public async Task HostSetScore(string playerId, int score)
    {
        if (!IsHost || SessionId is null) return;
        await engine.SetScore(SessionId, playerId, score);
    }

    public async Task HostTimeUp()
    {
        if (!IsHost || SessionId is null) return;
        await engine.TimeUp(SessionId);
    }

    public async Task HostSetPicker(string playerId)
    {
        if (!IsHost || SessionId is null) return;
        await engine.SetPicker(SessionId, playerId);
    }

    // ── player buzzer ───────────────────────────────────────────────────────

    public async Task PlayerBuzz()
    {
        if (SessionId is not null)
            await engine.Buzz(Context.ConnectionId, SessionId);
    }

    public async Task PlayerLeave()
    {
        if (SessionId is not null)
            await engine.PlayerDisconnect(Context.ConnectionId, SessionId);
    }

    // ── lifecycle ───────────────────────────────────────────────────────────

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        var sessionId = SessionId;
        if (sessionId is not null && !IsHost)
            await engine.PlayerDisconnect(Context.ConnectionId, sessionId);
        tracker.Remove(Context.ConnectionId);
        await base.OnDisconnectedAsync(exception);
    }

    // ── private ─────────────────────────────────────────────────────────────

    private async Task SendCallerState(string sessionId)
    {
        var session = await db.Sessions.Find(s => s.Id == sessionId).FirstOrDefaultAsync();

        Game? game = null;
        if (session?.GameId is not null)
            game = await db.Games.Find(g => g.Id == session.GameId).FirstOrDefaultAsync();

        await Clients.Caller.SendAsync("SessionState", GameEngineService.BuildPublicState(session, game));
    }
}
