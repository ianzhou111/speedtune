using MongoDB.Driver;
using SpeedTune.Api.Models;

namespace SpeedTune.Api.Services;

/// <summary>ISpeedTuneDb backed by MongoDB (cloud or local instance).</summary>
public class MongoSpeedTuneDb(MongoDbService mongo) : ISpeedTuneDb
{
    public Task<List<Game>> GetAllGamesAsync() =>
        mongo.Games.Find(_ => true).SortByDescending(g => g.CreatedAt).ToListAsync();

    public Task<Game?> GetGameAsync(string id) =>
        mongo.Games.Find(g => g.Id == id).FirstOrDefaultAsync()!;

    public Task InsertGameAsync(Game game) =>
        mongo.Games.InsertOneAsync(game);

    public async Task ReplaceGameAsync(string id, Game game) =>
        await mongo.Games.ReplaceOneAsync(g => g.Id == id, game);

    public async Task<bool> DeleteGameAsync(string id)
    {
        var result = await mongo.Games.DeleteOneAsync(g => g.Id == id);
        return result.DeletedCount > 0;
    }

    public Task<Session?> GetActiveSessionAsync() =>
        mongo.Sessions
            .Find(s => s.Status == "lobby" || s.Status == "active")
            .SortByDescending(s => s.CreatedAt)
            .FirstOrDefaultAsync()!;

    public Task InsertSessionAsync(Session session) =>
        mongo.Sessions.InsertOneAsync(session);

    public Task ReplaceSessionAsync(Session session) =>
        mongo.Sessions.ReplaceOneAsync(s => s.Id == session.Id, session);
}
