using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace SpeedTune.Api.Controllers;

[ApiController]
[Route("api/anisong")]
[Authorize]
public class AnisongController(IHttpClientFactory httpFactory) : ControllerBase
{
    private const string AnisongBase = "https://anisongdb.com/api";
    private const string CdnBase    = "https://naedist.animemusicquiz.com/";

    // ── POST /api/anisong/search ────────────────────────────────────────────
    // Body mirrors the AnisongDB search_request payload so the frontend
    // doesn't have to know about it — we just proxy + filter.

    [HttpPost("search")]
    public async Task<IActionResult> Search([FromBody] AnisongSearchRequest req)
    {
        using var client = httpFactory.CreateClient();
        client.DefaultRequestHeaders.Add("User-Agent", "SpeedTune/1.0");

        // Only send filters that have actual content — sending empty strings with
        // and_logic=false (OR) causes AnisongDB to return unexpected results.
        // Use and_logic=true so multiple populated filters narrow results (AND).
        var animeFilter  = !string.IsNullOrWhiteSpace(req.Anime)  ? new { search = req.Anime!,  partial_match = true } : null;
        var songFilter   = !string.IsNullOrWhiteSpace(req.Song)   ? new { search = req.Song!,   partial_match = true } : null;
        var artistFilter = !string.IsNullOrWhiteSpace(req.Artist) ? new { search = req.Artist!, partial_match = true } : null;

        var payload = new
        {
            anime_search_filter      = (object?)animeFilter,
            song_name_search_filter  = (object?)songFilter,
            artist_search_filter     = (object?)artistFilter,
            and_logic        = true,
            ignore_duplicate = false,
            opening_filter   = req.Opening,
            ending_filter    = req.Ending,
            insert_filter    = req.Insert,
        };

        var response = await client.PostAsJsonAsync($"{AnisongBase}/search_request", payload);
        if (!response.IsSuccessStatusCode)
            return StatusCode((int)response.StatusCode, new { message = "AnisongDB request failed" });

        var raw = await response.Content.ReadFromJsonAsync<List<AnisongResult>>() ?? [];

        // Keep all songs that have any playable URL (HQ video > MQ video > audio-only).
        // Drop only songs with zero URLs so the editor can still see audio-only tracks.
        string? ToUrl(string? file) =>
            string.IsNullOrWhiteSpace(file) ? null : CdnBase + file;

        var results = raw
            .Where(r => !string.IsNullOrWhiteSpace(r.HQ)
                     || !string.IsNullOrWhiteSpace(r.MQ)
                     || !string.IsNullOrWhiteSpace(r.Audio))
            .Select(r => new
            {
                r.AnnId,
                r.SongName,
                r.SongArtist,
                AnimeName = !string.IsNullOrWhiteSpace(r.AnimeENName) ? r.AnimeENName : r.AnimeJPName,
                r.AnimeVintage,
                r.SongType,
                SongLength = r.SongLength ?? 0f,
                VideoUrl = ToUrl(r.HQ) ?? ToUrl(r.MQ) ?? ToUrl(r.Audio) ?? ""
            })
            .ToList();

        return Ok(results);
    }
}

// ── DTOs ───────────────────────────────────────────────────────────────────

public record AnisongSearchRequest(
    string? Anime,
    string? Song,
    string? Artist,
    bool Opening = true,
    bool Ending  = true,
    bool Insert  = true);

public class AnisongResult
{
    [JsonPropertyName("annId")]       public int AnnId { get; set; }
    [JsonPropertyName("songName")]    public string SongName { get; set; } = "";
    [JsonPropertyName("songArtist")]  public string SongArtist { get; set; } = "";
    [JsonPropertyName("animeENName")] public string AnimeENName { get; set; } = "";
    [JsonPropertyName("animeJPName")] public string AnimeJPName { get; set; } = "";
    [JsonPropertyName("animeVintage")] public string AnimeVintage { get; set; } = "";
    [JsonPropertyName("songType")]    public string SongType { get; set; } = "";
    [JsonPropertyName("songLength")]  public float? SongLength { get; set; }
    [JsonPropertyName("HQ")]          public string? HQ { get; set; }
    [JsonPropertyName("MQ")]          public string? MQ { get; set; }
    [JsonPropertyName("audio")]       public string? Audio { get; set; }
}
