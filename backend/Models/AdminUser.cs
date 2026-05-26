using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

namespace SpeedTune.Api.Models;

public class AdminUser
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string Id { get; set; } = ObjectId.GenerateNewId().ToString();

    public string Username { get; set; } = "";

    /// <summary>
    /// PBKDF2-SHA256 hash stored as "base64salt:base64hash".
    /// </summary>
    public string PasswordHash { get; set; } = "";

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
