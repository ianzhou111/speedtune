using MongoDB.Driver;
using SpeedTune.Api.Models;

namespace SpeedTune.Api.Services;

public class MongoDbService
{
    private readonly IMongoDatabase _db;

    public MongoDbService(IConfiguration config)
    {
        var uri = config["MongoDB:Uri"] ?? throw new Exception("MongoDB:Uri not configured");
        var client = new MongoClient(uri);
        _db = client.GetDatabase("speedtune");
    }

    public IMongoCollection<Game> Games => _db.GetCollection<Game>("games");
    public IMongoCollection<Session> Sessions => _db.GetCollection<Session>("sessions");
}
