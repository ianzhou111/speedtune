using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Bson;
using SpeedTune.Api.Models;
using SpeedTune.Api.Services;

namespace SpeedTune.Api.Controllers;

[ApiController]
[Route("api/games")]
public class GamesController(ISpeedTuneDb db) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> GetAll() =>
        Ok(await db.GetAllGamesAsync());

    [HttpGet("{id}")]
    public async Task<IActionResult> GetById(string id)
    {
        var game = await db.GetGameAsync(id);
        return game is null ? NotFound() : Ok(game);
    }

    [HttpPost]
    [Authorize]
    public async Task<IActionResult> Create([FromBody] CreateGameRequest req)
    {
        var game = new Game
        {
            Name      = req.Name,
            Settings  = req.Settings ?? new GameSettings(),
            Cards     = [],
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        };
        await db.InsertGameAsync(game);
        return CreatedAtAction(nameof(GetById), new { id = game.Id }, game);
    }

    [HttpPut("{id}")]
    [Authorize]
    public async Task<IActionResult> Update(string id, [FromBody] UpdateGameRequest req)
    {
        var existing = await db.GetGameAsync(id);
        if (existing is null) return NotFound();

        if (req.Name is not null)     existing.Name     = req.Name;
        if (req.Settings is not null) existing.Settings = req.Settings;
        if (req.Cards is not null)    existing.Cards    = req.Cards;
        existing.UpdatedAt = DateTime.UtcNow;

        await db.ReplaceGameAsync(id, existing);
        return Ok(existing);
    }

    [HttpPost("{id}/duplicate")]
    [Authorize]
    public async Task<IActionResult> Duplicate(string id)
    {
        var source = await db.GetGameAsync(id);
        if (source is null) return NotFound();

        var copy = new Game
        {
            Name     = $"Copy of {source.Name}",
            Settings = source.Settings,
            Cards    = source.Cards
                .Select(c => new Card
                {
                    Id    = ObjectId.GenerateNewId().ToString(),
                    Label = c.Label,
                    Stars = c.Stars,
                    Songs = c.Songs.ToList(),
                })
                .ToList(),
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        };
        await db.InsertGameAsync(copy);
        return CreatedAtAction(nameof(GetById), new { id = copy.Id }, copy);
    }

    [HttpDelete("{id}")]
    [Authorize]
    public async Task<IActionResult> Delete(string id) =>
        await db.DeleteGameAsync(id) ? NoContent() : NotFound();
}

public record CreateGameRequest(string Name, GameSettings? Settings);
public record UpdateGameRequest(string? Name, GameSettings? Settings, List<Card>? Cards);
