using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SpeedTune.Api.Services;

namespace SpeedTune.Api.Controllers;

[ApiController]
[Route("api/offline")]
[Authorize]
public class OfflineController(OfflineMediaService offlineService) : ControllerBase
{
    /// <summary>
    /// Start downloading all media for a game to the local cache.
    /// Returns 409 if a download is already in progress.
    /// </summary>
    [HttpPost("cache/{gameId}")]
    public async Task<IActionResult> StartCache(string gameId)
    {
        var started = await offlineService.StartDownload(gameId);
        if (!started)
            return Conflict(new { Message = "Download already running or game not found." });
        return NoContent();
    }

    /// <summary>
    /// Poll the download progress for a game.
    /// Returns 404 if no download has been started for this game yet.
    /// </summary>
    [HttpGet("cache/{gameId}/status")]
    public IActionResult GetStatus(string gameId)
    {
        var status = offlineService.GetStatus(gameId);
        if (status is null) return NotFound();
        return Ok(status);
    }

    /// <summary>
    /// Delete all locally cached media for a game and reset LocalVideoUrl on every song.
    /// </summary>
    [HttpDelete("cache/{gameId}")]
    public async Task<IActionResult> DeleteCache(string gameId)
    {
        await offlineService.DeleteCache(gameId);
        return NoContent();
    }
}
