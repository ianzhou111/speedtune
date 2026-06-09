using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;
using MongoDB.Bson.Serialization.Options;

namespace SpeedTune.Api.Models;

public class SongEntry
{
    public int AnnId { get; set; }
    public string SongName { get; set; } = "";
    public string SongArtist { get; set; } = "";
    public string AnimeName { get; set; } = "";
    public string AnimeVintage { get; set; } = "";
    public string SongType { get; set; } = "";
    public string VideoUrl { get; set; } = "";
    /// <summary>Song duration in seconds (from AnisongDB), used to calculate playback range.</summary>
    public float SongLength { get; set; } = 0;
    /// <summary>Minimum playback start point as a percentage 0–100.</summary>
    public int StartMin { get; set; } = 0;
    /// <summary>Maximum playback start point as a percentage 0–100.</summary>
    public int StartMax { get; set; } = 0;
}

public class Card
{
    // Cards are embedded documents — store Id as a plain string (UUID from frontend is fine)
    public string Id { get; set; } = ObjectId.GenerateNewId().ToString();
    public string Label { get; set; } = "";
    public int Stars { get; set; } = 1;
    public List<SongEntry> Songs { get; set; } = new();
}

public class GameSettings
{
    public int ClipDuration { get; set; } = 60;
    public int BuzzTimerSeconds { get; set; } = 30;
    public int WrongAnswerDeduction { get; set; } = 0;
    [BsonDictionaryOptions(DictionaryRepresentation.ArrayOfArrays)]
    public Dictionary<int, int> StarPointMap { get; set; } = new()
    {
        { 1, 100 }, { 2, 200 }, { 3, 300 }, { 4, 400 }, { 5, 500 }
    };
}

public class Game
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string Id { get; set; } = ObjectId.GenerateNewId().ToString();
    public string Name { get; set; } = "";
    public GameSettings Settings { get; set; } = new();
    public List<Card> Cards { get; set; } = new();
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
