using SpeedTune.Api.Models;

namespace SpeedTune.Api.Services;

/// <summary>
/// ISpeedTuneDb that delegates every call to either MongoSpeedTuneDb or
/// LocalSpeedTuneDb depending on the current StorageModeService setting.
/// </summary>
public class RoutingSpeedTuneDb : ISpeedTuneDb
{
    private readonly StorageModeService _mode;
    private readonly LocalSpeedTuneDb   _local;
    private readonly MongoSpeedTuneDb?  _mongo;

    public RoutingSpeedTuneDb(StorageModeService mode, LocalSpeedTuneDb local, IServiceProvider sp)
    {
        _mode  = mode;
        _local = local;
        _mongo = sp.GetService<MongoSpeedTuneDb>(); // null when MongoDB is not configured
    }

    private ISpeedTuneDb Active =>
        _mode.CurrentMode == "mongo" && _mongo is not null ? _mongo : _local;

    public Task<List<Game>>  GetAllGamesAsync()              => Active.GetAllGamesAsync();
    public Task<Game?>        GetGameAsync(string id)         => Active.GetGameAsync(id);
    public Task               InsertGameAsync(Game game)      => Active.InsertGameAsync(game);
    public Task               ReplaceGameAsync(string id, Game game) => Active.ReplaceGameAsync(id, game);
    public Task<bool>         DeleteGameAsync(string id)      => Active.DeleteGameAsync(id);
    public Task<Session?>     GetActiveSessionAsync()         => Active.GetActiveSessionAsync();
    public Task               InsertSessionAsync(Session s)   => Active.InsertSessionAsync(s);
    public Task               ReplaceSessionAsync(Session s)  => Active.ReplaceSessionAsync(s);
}
