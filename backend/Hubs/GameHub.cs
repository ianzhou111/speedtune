using Microsoft.AspNetCore.SignalR;
using MongoDB.Driver;
using SpeedTune.Api.Models;
using SpeedTune.Api.Services;

namespace SpeedTune.Api.Hubs;

public class GameHub(GameEngineService engine, MongoDbService db) : Hub
{
    // ── helpers ────────────────────────────────────────────────────────────

    private bool IsHost() => Context.User?.Identity?.IsAuthenticated == true;

    // ── player ─────────────────────────────────────────────────────────────

    /// <summary>
    /// Called by each player browser on page load.
    /// Adds connection to the "players" group and upserts them into the session.
    /// </summary>
    public async Task PlayerJoin(string name, string color)
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, "players");
        await engine.PlayerJoin(Context.ConnectionId, name, color);
    }

    // ── display screen ─────────────────────────────────────────────────────

    /// <summary>
    /// Called by the public display screen. No auth required.
    /// Adds to "display" group and sends current state snapshot.
    /// </summary>
    public async Task DisplayJoin()
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, "display");
        await SendCallerState();
    }

    // ── host ────────────────────────────────────────────────────────────────

    /// <summary>
    /// Called by the host control panel after login.
    /// Requires a valid JWT (passed as ?access_token= query param).
    /// </summary>
    public async Task HostJoin()
    {
        if (!IsHost())
        {
            await Clients.Caller.SendAsync("Error", new { Message = "Unauthorized" });
            return;
        }
        await Groups.AddToGroupAsync(Context.ConnectionId, "host");
        await SendCallerState();
    }

    public async Task HostStartGame()
    {
        if (!IsHost()) return;
        await engine.StartGame();
    }

    public async Task HostOpenCard(string cardId)
    {
        if (!IsHost()) return;
        await engine.OpenCard(cardId);
    }

    public async Task HostJudge(bool correct)
    {
        if (!IsHost()) return;
        await engine.Judge(correct);
    }

    public async Task HostSkip()
    {
        if (!IsHost()) return;
        await engine.Skip();
    }

    public async Task HostNextSong()
    {
        if (!IsHost()) return;
        await engine.NextSong();
    }

    public async Task HostPauseAudio()
    {
        if (!IsHost()) return;
        await Clients.Group("display").SendAsync("RoundAudioPause");
    }

    public async Task HostResumeAudio()
    {
        if (!IsHost()) return;
        await Clients.Group("display").SendAsync("RoundAudioPlay");
    }

    public async Task HostKickPlayer(string playerId)
    {
        if (!IsHost()) return;
        await engine.KickPlayer(playerId);
    }

    public async Task HostEndGame()
    {
        if (!IsHost()) return;
        await engine.EndGame();
    }

    public async Task HostSetScore(string playerId, int score)
    {
        if (!IsHost()) return;
        await engine.SetScore(playerId, score);
    }

    // ── player buzzer ───────────────────────────────────────────────────────

    public async Task PlayerBuzz() => await engine.Buzz(Context.ConnectionId);

    // ── lifecycle ───────────────────────────────────────────────────────────

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        await engine.PlayerDisconnect(Context.ConnectionId);
        await base.OnDisconnectedAsync(exception);
    }

    // ── private ─────────────────────────────────────────────────────────────

    private async Task SendCallerState()
    {
        var session = await db.Sessions
            .Find(s => s.Status == "lobby" || s.Status == "active")
            .SortByDescending(s => s.CreatedAt)
            .FirstOrDefaultAsync();

        Game? game = null;
        if (session?.GameId is not null)
            game = await db.Games.Find(g => g.Id == session.GameId).FirstOrDefaultAsync();

        await Clients.Caller.SendAsync("SessionState", GameEngineService.BuildPublicState(session, game));
    }
}
