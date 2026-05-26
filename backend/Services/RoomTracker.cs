using System.Collections.Concurrent;

namespace SpeedTune.Api.Services;

/// <summary>
/// Singleton that maps each SignalR connection to its session and role.
/// </summary>
public class RoomTracker
{
    private readonly ConcurrentDictionary<string, Entry> _map = new();

    private record Entry(string SessionId, bool IsHost);

    public void Track(string connectionId, string sessionId, bool isHost)
        => _map[connectionId] = new Entry(sessionId, isHost);

    public void Remove(string connectionId)
        => _map.TryRemove(connectionId, out _);

    public string? GetSessionId(string connectionId)
        => _map.TryGetValue(connectionId, out var e) ? e.SessionId : null;

    public bool IsHostConnection(string connectionId)
        => _map.TryGetValue(connectionId, out var e) && e.IsHost;
}
