using Microsoft.AspNetCore.Mvc;
using MongoDB.Driver;
using SpeedTune.Api.Models;
using SpeedTune.Api.Services;

namespace SpeedTune.Api.Controllers;

[ApiController]
[Route("api/sessions")]
public class SessionsController(MongoDbService db) : ControllerBase
{
    // ── GET /api/sessions/active ────────────────────────────────────────────
    // Legacy endpoint — returns the most recently created active session.
    // With multi-room, clients use room codes instead, but this is kept for
    // tooling/debug convenience.

    [HttpGet("active")]
    public async Task<IActionResult> GetActive()
    {
        var session = await db.Sessions
            .Find(s => s.Status == "lobby" || s.Status == "active")
            .SortByDescending(s => s.CreatedAt)
            .FirstOrDefaultAsync();

        if (session is null) return Ok(null);

        var game = await db.Games.Find(g => g.Id == session.GameId).FirstOrDefaultAsync();
        return Ok(GameEngineService.BuildPublicState(session, game));
    }

    // ── POST /api/sessions ──────────────────────────────────────────────────
    // Open endpoint — no JWT required. Whoever creates the session receives
    // a secret hostToken that authorises hub calls for that session only.

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateSessionRequest req)
    {
        var game = await db.Games.Find(g => g.Id == req.GameId).FirstOrDefaultAsync();
        if (game is null) return BadRequest(new { message = "Game not found" });

        var roomCode  = GenerateRoomCode();
        var hostToken = Guid.NewGuid().ToString("N"); // 32-char hex secret

        var session = new Session
        {
            GameId    = req.GameId,
            Status    = "lobby",
            RoomCode  = roomCode,
            HostToken = hostToken,
            Players   = [],
            PlayedSongs = [],
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };
        await db.Sessions.InsertOneAsync(session);

        return Ok(new { Id = session.Id, RoomCode = roomCode, HostToken = hostToken });
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    /// <summary>
    /// Generates a 6-character alphanumeric room code (no ambiguous chars).
    /// </summary>
    private static string GenerateRoomCode()
    {
        const string chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1
        return new string(Enumerable.Range(0, 6)
            .Select(_ => chars[Random.Shared.Next(chars.Length)])
            .ToArray());
    }
}

public record CreateSessionRequest(string GameId);
