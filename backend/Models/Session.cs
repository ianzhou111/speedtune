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
    public bool IsTimedOut { get; set; }
}

public class Session
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string Id { get; set; } = ObjectId.GenerateNewId().ToString();

    [BsonRepresentation(BsonType.ObjectId)]
    public string GameId { get; set; } = "";
    public string Status { get; set; } = "lobby"; // "lobby" | "active" | "ended"
    public string RoomCode { get; set; } = "";     // 6-char public join code
    public string HostToken { get; set; } = "";    // secret token for host auth
    public List<Player> Players { get; set; } = new();
    public List<PlayedSong> PlayedSongs { get; set; } = new();
    public CurrentRound? CurrentRound { get; set; }
    public List<string> PickOrder { get; set; } = new();
    public int CurrentPickerIndex { get; set; } = 0;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    [BsonIgnore]
    public string? CurrentPickerId => PickOrder.Count > 0
        ? PickOrder[CurrentPickerIndex % PickOrder.Count]
        : null;
}
