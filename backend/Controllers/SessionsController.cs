using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SpeedTune.Api.Models;
using SpeedTune.Api.Services;

namespace SpeedTune.Api.Controllers;

[ApiController]
[Route("api/sessions")]
public class SessionsController(ISpeedTuneDb db) : ControllerBase
{
    [HttpGet("active")]
    public async Task<IActionResult> GetActive()
    {
        var session = await db.GetActiveSessionAsync();
        if (session is null) return Ok(null);

        var game = await db.GetGameAsync(session.GameId);
        return Ok(GameEngineService.BuildPublicState(session, game));
    }

    [HttpPost]
    [Authorize]
    public async Task<IActionResult> Create([FromBody] CreateSessionRequest req)
    {
        var game = await db.GetGameAsync(req.GameId);
        if (game is null) return BadRequest(new { message = "Game not found" });

        // End any existing active/lobby session first
        var existing = await db.GetActiveSessionAsync();
        if (existing is not null)
        {
            existing.Status = "ended";
            await db.ReplaceSessionAsync(existing);
        }

        var session = new Session
        {
            GameId     = req.GameId,
            Status     = "lobby",
            Players    = [],
            PlayedSongs = [],
            CreatedAt  = DateTime.UtcNow,
            UpdatedAt  = DateTime.UtcNow,
        };
        await db.InsertSessionAsync(session);
        return Ok(GameEngineService.BuildPublicState(session, game));
    }
}

public record CreateSessionRequest(string GameId);
