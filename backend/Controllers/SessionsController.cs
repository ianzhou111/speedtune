using Microsoft.AspNetCore.Authorization;
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

    [HttpPost]
    [Authorize]
    public async Task<IActionResult> Create([FromBody] CreateSessionRequest req)
    {
        var game = await db.Games.Find(g => g.Id == req.GameId).FirstOrDefaultAsync();
        if (game is null) return BadRequest(new { message = "Game not found" });

        // End any existing active/lobby session first
        var existing = await db.Sessions
            .Find(s => s.Status == "lobby" || s.Status == "active")
            .FirstOrDefaultAsync();
        if (existing is not null)
        {
            existing.Status = "ended";
            await db.Sessions.ReplaceOneAsync(s => s.Id == existing.Id, existing);
        }

        var session = new Session
        {
            GameId = req.GameId,
            Status = "lobby",
            Players = [],
            PlayedSongs = [],
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };
        await db.Sessions.InsertOneAsync(session);
        return Ok(GameEngineService.BuildPublicState(session, game));
    }
}

public record CreateSessionRequest(string GameId);
