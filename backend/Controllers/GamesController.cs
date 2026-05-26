using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MongoDB.Driver;
using SpeedTune.Api.Models;
using SpeedTune.Api.Services;

namespace SpeedTune.Api.Controllers;

[ApiController]
[Route("api/games")]
public class GamesController(MongoDbService db) : ControllerBase
{
    // ── GET /api/games ─────────────────────────────────────────────────────

    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
        var games = await db.Games
            .Find(_ => true)
            .SortByDescending(g => g.CreatedAt)
            .ToListAsync();

        return Ok(games);
    }

    // ── GET /api/games/{id} ────────────────────────────────────────────────

    [HttpGet("{id}")]
    public async Task<IActionResult> GetById(string id)
    {
        var game = await db.Games.Find(g => g.Id == id).FirstOrDefaultAsync();
        return game is null ? NotFound() : Ok(game);
    }

    // ── POST /api/games ────────────────────────────────────────────────────

    [HttpPost]
    [Authorize]
    public async Task<IActionResult> Create([FromBody] CreateGameRequest req)
    {
        var game = new Game
        {
            Name = req.Name,
            Settings = req.Settings ?? new GameSettings(),
            Cards = [],
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };
        await db.Games.InsertOneAsync(game);
        return CreatedAtAction(nameof(GetById), new { id = game.Id }, game);
    }

    // ── PUT /api/games/{id} ────────────────────────────────────────────────

    [HttpPut("{id}")]
    [Authorize]
    public async Task<IActionResult> Update(string id, [FromBody] UpdateGameRequest req)
    {
        var existing = await db.Games.Find(g => g.Id == id).FirstOrDefaultAsync();
        if (existing is null) return NotFound();

        if (req.Name is not null) existing.Name = req.Name;
        if (req.Settings is not null) existing.Settings = req.Settings;
        if (req.Cards is not null) existing.Cards = req.Cards;
        existing.UpdatedAt = DateTime.UtcNow;

        await db.Games.ReplaceOneAsync(g => g.Id == id, existing);
        return Ok(existing);
    }

    // ── POST /api/games/{id}/duplicate ────────────────────────────────────

    [HttpPost("{id}/duplicate")]
    [Authorize]
    public async Task<IActionResult> Duplicate(string id)
    {
        var source = await db.Games.Find(g => g.Id == id).FirstOrDefaultAsync();
        if (source is null) return NotFound();

        var copy = new Game
        {
            Name      = $"Copy of {source.Name}",
            Settings  = source.Settings,
            Cards     = source.Cards
                .Select(c => new Card
                {
                    Id    = MongoDB.Bson.ObjectId.GenerateNewId().ToString(),
                    Label = c.Label,
                    Stars = c.Stars,
                    Songs = c.Songs.ToList(),
                })
                .ToList(),
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
        };
        await db.Games.InsertOneAsync(copy);
        return CreatedAtAction(nameof(GetById), new { id = copy.Id }, copy);
    }

    // ── DELETE /api/games/{id} ─────────────────────────────────────────────

    [HttpDelete("{id}")]
    [Authorize]
    public async Task<IActionResult> Delete(string id)
    {
        var result = await db.Games.DeleteOneAsync(g => g.Id == id);
        return result.DeletedCount == 0 ? NotFound() : NoContent();
    }
}

public record CreateGameRequest(string Name, GameSettings? Settings);
public record UpdateGameRequest(string? Name, GameSettings? Settings, List<Card>? Cards);
