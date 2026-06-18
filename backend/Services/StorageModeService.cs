using System.Text.Json;

namespace SpeedTune.Api.Services;

/// <summary>
/// Tracks which storage backend is currently active ("local" or "mongo") and
/// persists the choice to data/storage-mode.json so it survives restarts.
/// </summary>
public class StorageModeService
{
    private readonly string _modeFile;
    private string _current;

    public bool MongoAvailable { get; }

    public string CurrentMode => _current;

    public StorageModeService(IWebHostEnvironment env, IConfiguration config)
    {
        MongoAvailable = !string.IsNullOrWhiteSpace(config["MongoDB:Uri"]);

        var dataDir = Path.Combine(env.ContentRootPath, "data");
        Directory.CreateDirectory(dataDir);
        _modeFile = Path.Combine(dataDir, "storage-mode.json");

        // Load saved preference
        if (File.Exists(_modeFile))
        {
            try
            {
                var doc  = JsonDocument.Parse(File.ReadAllText(_modeFile));
                var saved = doc.RootElement.GetProperty("mode").GetString() ?? "";
                _current = saved == "mongo" && MongoAvailable ? "mongo" : "local";
            }
            catch { _current = MongoAvailable ? "mongo" : "local"; }
        }
        else
        {
            _current = MongoAvailable ? "mongo" : "local";
        }
    }

    public void SetMode(string mode)
    {
        if (mode == "mongo" && !MongoAvailable) return;
        _current = mode == "mongo" ? "mongo" : "local";
        File.WriteAllText(_modeFile, JsonSerializer.Serialize(new { mode = _current }));
    }
}
