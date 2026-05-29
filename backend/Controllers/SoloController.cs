using Microsoft.AspNetCore.Mvc;
using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace SpeedTune.Api.Controllers;

[ApiController]
[Route("api/solo")]
public class SoloController(IHttpClientFactory httpFactory) : ControllerBase
{
    private const string AnisongBase = "https://anisongdb.com/api";
    private const string CdnBase     = "https://naedist.animemusicquiz.com/";

    // ── GET /api/solo/mal/{username}?filter=both|completed ─────────────────
    // Proxies Jikan v4 (unofficial MAL API) to avoid CORS.
    // Returns a deduplicated list of anime title strings.

    [HttpGet("mal/{username}")]
    public async Task<IActionResult> GetMalList(string username, [FromQuery] string filter = "both")
    {
        using var client = httpFactory.CreateClient();
        client.DefaultRequestHeaders.Add("User-Agent", "SpeedTune/1.0");

        // Jikan status codes: 1=watching, 2=completed
        var statuses = filter == "completed" ? new[] { 2 } : new[] { 1, 2 };
        var titles = new List<string>();

        foreach (var status in statuses)
        {
            var page = 1;
            while (true)
            {
                var url = $"https://api.jikan.moe/v4/users/{Uri.EscapeDataString(username)}/animelist" +
                          $"?status={status}&limit=300&page={page}";

                var res = await client.GetAsync(url);

                if (res.StatusCode == System.Net.HttpStatusCode.NotFound)
                    return NotFound(new { message = $"MAL user '{username}' not found" });
                if (res.StatusCode == System.Net.HttpStatusCode.TooManyRequests)
                    return StatusCode(429, new { message = "MAL rate limit hit — try again in a moment" });
                if (!res.IsSuccessStatusCode)
                    return StatusCode((int)res.StatusCode, new { message = "MAL API error" });

                var data = await res.Content.ReadFromJsonAsync<JikanListResponse>();
                if (data?.Data is null || data.Data.Count == 0) break;

                titles.AddRange(data.Data
                    .Select(e => e.Title)
                    .Where(t => !string.IsNullOrWhiteSpace(t)));

                if (!data.Pagination.HasNextPage) break;
                page++;
                await Task.Delay(400); // respect Jikan 3 req/sec limit
            }
        }

        return Ok(titles.Distinct(StringComparer.OrdinalIgnoreCase).ToList());
    }

    // ── GET /api/solo/anilist/{username}?filter=both|completed ─────────────
    // Queries AniList GraphQL (public, no auth needed).

    [HttpGet("anilist/{username}")]
    public async Task<IActionResult> GetAnilistList(string username, [FromQuery] string filter = "both")
    {
        using var client = httpFactory.CreateClient();

        var statuses = filter == "completed"
            ? new[] { "COMPLETED" }
            : new[] { "COMPLETED", "CURRENT" };

        const string query = """
            query ($username: String, $statuses: [MediaListStatus]) {
              MediaListCollection(userName: $username, type: ANIME, status_in: $statuses) {
                lists {
                  entries {
                    media {
                      title { romaji english }
                    }
                  }
                }
              }
            }
            """;

        var payload = new
        {
            query,
            variables = new { username, statuses },
        };

        var res = await client.PostAsJsonAsync("https://graphql.anilist.co", payload);

        if (!res.IsSuccessStatusCode)
            return StatusCode((int)res.StatusCode, new { message = "AniList API error" });

        var body = await res.Content.ReadFromJsonAsync<AnilistResponse>();

        // Surface GraphQL-level errors (e.g. user not found)
        if (body?.Errors is { Count: > 0 })
            return NotFound(new { message = body.Errors[0].Message });

        var titles = body?.Data?.MediaListCollection?.Lists
            .SelectMany(l => l.Entries)
            .Select(e => e.Media.Title.English ?? e.Media.Title.Romaji ?? "")
            .Where(t => !string.IsNullOrWhiteSpace(t))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList() ?? [];

        return Ok(titles);
    }

    // ── POST /api/solo/songs ────────────────────────────────────────────────
    // Accepts up to 150 anime titles, returns a map of animeName → songs.
    // Public (no auth) — just proxying the public anisongdb API.

    [HttpPost("songs")]
    public async Task<IActionResult> GetSongs([FromBody] SoloSongsRequest req)
    {
        if (req.AnimeTitles is null || req.AnimeTitles.Count == 0)
            return BadRequest(new { message = "animeTitles is required" });

        // Hard cap to prevent abuse
        var titles = req.AnimeTitles.Take(150).ToList();

        using var client = httpFactory.CreateClient();
        client.DefaultRequestHeaders.Add("User-Agent", "SpeedTune/1.0");

        var results = new ConcurrentDictionary<string, List<SoloSongEntry>>();
        var sem = new SemaphoreSlim(5); // max 5 concurrent requests to anisongdb

        var tasks = titles.Select(async title =>
        {
            await sem.WaitAsync();
            try
            {
                var payload = new
                {
                    anime_search_filter = new { search = title, partial_match = true },
                    and_logic           = true,
                    ignore_duplicate    = false,
                    opening_filter      = req.Openings,
                    ending_filter       = req.Endings,
                    insert_filter       = req.Inserts,
                };

                var res = await client.PostAsJsonAsync($"{AnisongBase}/search_request", payload);
                if (!res.IsSuccessStatusCode) return;

                var raw = await res.Content.ReadFromJsonAsync<List<AnisongRaw>>() ?? [];

                var songs = raw
                    .Where(r => !string.IsNullOrWhiteSpace(r.HQ)
                             || !string.IsNullOrWhiteSpace(r.MQ)
                             || !string.IsNullOrWhiteSpace(r.Audio))
                    .Select(r =>
                    {
                        string? Url(string? f) => string.IsNullOrWhiteSpace(f) ? null : CdnBase + f;
                        return new SoloSongEntry
                        {
                            AnimeName  = !string.IsNullOrWhiteSpace(r.AnimeENName) ? r.AnimeENName : r.AnimeJPName,
                            SongName   = r.SongName,
                            SongArtist = r.SongArtist,
                            SongType   = r.SongType,
                            VideoUrl   = Url(r.HQ) ?? Url(r.MQ) ?? Url(r.Audio) ?? "",
                            SongLength = r.SongLength ?? 0f,
                        };
                    })
                    .ToList();

                if (songs.Count > 0)
                    results[title] = songs;
            }
            finally { sem.Release(); }
        });

        await Task.WhenAll(tasks);
        return Ok(results);
    }
}

// ── Request / Response DTOs ────────────────────────────────────────────────

public record SoloSongsRequest(
    List<string> AnimeTitles,
    bool Openings = true,
    bool Endings  = true,
    bool Inserts  = false);

public class SoloSongEntry
{
    public string AnimeName  { get; set; } = "";
    public string SongName   { get; set; } = "";
    public string SongArtist { get; set; } = "";
    public string SongType   { get; set; } = "";
    public string VideoUrl   { get; set; } = "";
    public float  SongLength { get; set; }
}

// ── Jikan v4 DTOs ──────────────────────────────────────────────────────────

public class JikanListResponse
{
    [JsonPropertyName("data")]
    public List<JikanAnimeEntry> Data { get; set; } = [];

    [JsonPropertyName("pagination")]
    public JikanPagination Pagination { get; set; } = new();
}

public class JikanAnimeEntry
{
    [JsonPropertyName("title")]
    public string Title { get; set; } = "";
}

public class JikanPagination
{
    [JsonPropertyName("has_next_page")]
    public bool HasNextPage { get; set; }
}

// ── AniList DTOs ───────────────────────────────────────────────────────────

public class AnilistResponse
{
    [JsonPropertyName("data")]
    public AnilistData? Data { get; set; }

    [JsonPropertyName("errors")]
    public List<AnilistError>? Errors { get; set; }
}

public class AnilistError
{
    [JsonPropertyName("message")]
    public string Message { get; set; } = "";
}

public class AnilistData
{
    [JsonPropertyName("MediaListCollection")]
    public AnilistCollection? MediaListCollection { get; set; }
}

public class AnilistCollection
{
    [JsonPropertyName("lists")]
    public List<AnilistList> Lists { get; set; } = [];
}

public class AnilistList
{
    [JsonPropertyName("entries")]
    public List<AnilistEntry> Entries { get; set; } = [];
}

public class AnilistEntry
{
    [JsonPropertyName("media")]
    public AnilistMedia Media { get; set; } = new();
}

public class AnilistMedia
{
    [JsonPropertyName("title")]
    public AnilistTitle Title { get; set; } = new();
}

public class AnilistTitle
{
    [JsonPropertyName("romaji")]
    public string? Romaji { get; set; }

    [JsonPropertyName("english")]
    public string? English { get; set; }
}

// ── AnisongDB raw response ─────────────────────────────────────────────────

public class AnisongRaw
{
    [JsonPropertyName("songName")]    public string SongName    { get; set; } = "";
    [JsonPropertyName("songArtist")]  public string SongArtist  { get; set; } = "";
    [JsonPropertyName("animeENName")] public string AnimeENName { get; set; } = "";
    [JsonPropertyName("animeJPName")] public string AnimeJPName { get; set; } = "";
    [JsonPropertyName("songType")]    public string SongType    { get; set; } = "";
    [JsonPropertyName("songLength")]  public float? SongLength  { get; set; }
    [JsonPropertyName("HQ")]          public string? HQ         { get; set; }
    [JsonPropertyName("MQ")]          public string? MQ         { get; set; }
    [JsonPropertyName("audio")]       public string? Audio      { get; set; }
}
