using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SpeedTune.Api.Services;

namespace SpeedTune.Api.Controllers;

[ApiController]
[Route("api/admin/storage-mode")]
public class StorageModeController(
    StorageModeService storageMode,
    LocalSpeedTuneDb   local,
    IServiceProvider   sp) : ControllerBase
{
    // Mongo may not be registered when MongoDB:Uri is unset
    private MongoSpeedTuneDb? Mongo => sp.GetService<MongoSpeedTuneDb>();

    // ── GET current mode ────────────────────────────────────────────────────

    [HttpGet]
    [Authorize]
    public IActionResult Get() => Ok(new
    {
        Mode           = storageMode.CurrentMode,
        MongoAvailable = storageMode.MongoAvailable,
    });

    // ── PUT switch mode ─────────────────────────────────────────────────────

    [HttpPut]
    [Authorize]
    public IActionResult Set([FromBody] SetStorageModeRequest req)
    {
        if (req.Mode != "local" && req.Mode != "mongo")
            return BadRequest(new { Message = "Mode must be 'local' or 'mongo'." });

        if (req.Mode == "mongo" && !storageMode.MongoAvailable)
            return BadRequest(new { Message = "MongoDB is not configured on this server." });

        storageMode.SetMode(req.Mode);
        return Ok(new { Mode = storageMode.CurrentMode });
    }

    // ── GET IDs of games already stored locally ─────────────────────────────

    [HttpGet("local-ids")]
    [Authorize]
    public async Task<IActionResult> GetLocalIds()
    {
        var games = await local.GetAllGamesAsync();
        return Ok(games.Select(g => g.Id).ToList());
    }

    // ── POST copy one game from cloud → local ───────────────────────────────

    [HttpPost("download/{gameId}")]
    [Authorize]
    public async Task<IActionResult> DownloadToLocal(string gameId)
    {
        if (!storageMode.MongoAvailable || Mongo is null)
            return BadRequest(new { Message = "MongoDB is not configured." });

        var game = await Mongo.GetGameAsync(gameId);
        if (game is null) return NotFound();

        // Upsert — overwrite any existing local copy with the same ID
        var existing = await local.GetGameAsync(gameId);
        if (existing is not null)
            await local.ReplaceGameAsync(gameId, game);
        else
            await local.InsertGameAsync(game);

        return Ok(game);
    }
}

public record SetStorageModeRequest(string Mode);
