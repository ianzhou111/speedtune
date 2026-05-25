using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace SpeedTune.Api.Models;

public class Player
{
    public string SocketId { get; set; } = "";
    public string Name { get; set; } = "";
    public string Color { get; set; } = "";
    public int Score { get; set; } = 0;
    public DateTime? BannedUntil { get; set; }
}

public class PlayedSong
{
    public string CardId { get; set; } = "";
    public int SongIndex { get; set; }
}

public class CurrentRound
{
    public string CardId { get; set; } = "";
    public int SongIndex { get; set; }
    public string Phase { get; set; } = "guess"; // "guess" | "reveal"
    public string? BuzzedPlayerId { get; set; }
    public List<string> ExhaustedBuzzers { get; set; } = new();
}

public class Session
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string Id { get; set; } = ObjectId.GenerateNewId().ToString();

    [BsonRepresentation(BsonType.ObjectId)]
    public string GameId { get; set; } = "";
    public string Status { get; set; } = "lobby"; // "lobby" | "active" | "ended"
    public List<Player> Players { get; set; } = new();
    public List<PlayedSong> PlayedSongs { get; set; } = new();
    public CurrentRound? CurrentRound { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
