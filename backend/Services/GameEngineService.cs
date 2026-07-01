using Microsoft.AspNetCore.SignalR;
using SpeedTune.Api.Hubs;
using SpeedTune.Api.Models;

namespace SpeedTune.Api.Services;

public class GameEngineService(ISpeedTuneDb db, IHubContext<GameHub> hub)
{
    // ── display preload tracking ───────────────────────────────────────────

    private readonly object          _displayLock              = new();
    private readonly HashSet<string> _connectedDisplays        = new();
    private          HashSet<string> _preloadExpectedDisplays  = new();
    private readonly HashSet<string> _preloadReadyDisplays     = new();
    private          bool            _preloadInProgress;

    public void DisplayConnect(string connectionId)
    {
        lock (_displayLock) _connectedDisplays.Add(connectionId);
    }

    public async Task DisplayDisconnect(string connectionId)
    {
        bool unblock;
        lock (_displayLock)
        {
            _connectedDisplays.Remove(connectionId);
            _preloadExpectedDisplays.Remove(connectionId);
            _preloadReadyDisplays.Remove(connectionId);
            unblock = _preloadInProgress && (
                _preloadExpectedDisplays.Count == 0 ||
                _preloadExpectedDisplays.All(id => _preloadReadyDisplays.Contains(id)));
            if (unblock) _preloadInProgress = false;
        }
        if (unblock) await hub.Clients.Group("host").SendAsync("AllDisplaysReady");
    }

    public async Task DisplayPreloadReady(string connectionId)
    {
        bool unblock;
        lock (_displayLock)
        {
            _preloadReadyDisplays.Add(connectionId);
            unblock = _preloadInProgress &&
                      _preloadExpectedDisplays.Count > 0 &&
                      _preloadExpectedDisplays.All(id => _preloadReadyDisplays.Contains(id));
            if (unblock) _preloadInProgress = false;
        }
        if (unblock) await hub.Clients.Group("host").SendAsync("AllDisplaysReady");
    }

    private async Task StartPreload(string? videoUrl)
    {
        HashSet<string> expected;
        lock (_displayLock)
        {
            _preloadReadyDisplays.Clear();
            expected = _preloadExpectedDisplays = new HashSet<string>(_connectedDisplays);
            _preloadInProgress = !string.IsNullOrEmpty(videoUrl) && expected.Count > 0;
        }
        if (!_preloadInProgress)
        {
            // No displays connected or no next song — let host proceed immediately
            await hub.Clients.Group("host").SendAsync("AllDisplaysReady");
            return;
        }
        await hub.Clients.Group("display").SendAsync("PreloadNext", new { VideoUrl = videoUrl });
    }

    // ── helpers ────────────────────────────────────────────────────────────

    private Task<Session?> GetActiveSession() => db.GetActiveSessionAsync();

    private Task<Game?> GetGame(string gameId) => db.GetGameAsync(gameId);

    private static object BuildPlayerDto(Player p) =>
        new { p.SocketId, p.Name, p.Color, p.Score };

    private static object BuildScores(List<Player> players) =>
        new { Scores = players.Select(BuildPlayerDto) };

    // ── player join ────────────────────────────────────────────────────────

    public async Task PlayerJoin(string socketId, string name, string color, bool skipActiveCheck = false)
    {
        var session = await GetActiveSession();
        if (session is null) return;

        // Player with same name but different socket = browser refresh / reconnect
        var sameNamePlayer = session.Players.FirstOrDefault(p => p.Name == name && p.SocketId != socketId);

        if (sameNamePlayer?.BannedUntil > DateTime.UtcNow)
        {
            var retryAfter = (int)(sameNamePlayer.BannedUntil.Value - DateTime.UtcNow).TotalMilliseconds;
            await hub.Clients.Client(socketId).SendAsync("Error", new { Message = "banned", RetryAfter = retryAfter });
            return;
        }

        // Block new players from joining an active game (reconnects allowed)
        // skipActiveCheck = true when an admin has overridden this restriction
        if (!skipActiveCheck && session.Status == "active" && sameNamePlayer is null &&
            !session.Players.Any(p => p.SocketId == socketId))
        {
            await hub.Clients.Client(socketId).SendAsync("Error", new { Message = "Game already in progress" });
            return;
        }

        // Color conflict — but allow if it's the reconnecting player keeping their own color
        if (session.Players.Any(p => p.Color == color && p.SocketId != socketId) && sameNamePlayer?.Color != color)
        {
            await hub.Clients.Client(socketId).SendAsync("Error", new { Message = "Color already taken" });
            return;
        }

        string? oldSocketId = null;
        var existingBySocket = session.Players.FirstOrDefault(p => p.SocketId == socketId);
        if (existingBySocket is not null)
        {
            existingBySocket.Name = name;
            existingBySocket.Color = color;
        }
        else if (sameNamePlayer is not null)
        {
            // Reconnect — take over existing slot so score is preserved
            oldSocketId = sameNamePlayer.SocketId;
            var pickIdx = session.PickOrder.IndexOf(oldSocketId);
            if (pickIdx != -1) session.PickOrder[pickIdx] = socketId;
            sameNamePlayer.SocketId = socketId;
            sameNamePlayer.Color = color;
        }
        else
        {
            session.Players.Add(new Player { SocketId = socketId, Name = name, Color = color });
            // Force-joining mid-game: append to end of pick order so they get turns
            if (session.Status == "active")
                session.PickOrder.Add(socketId);
        }

        await db.ReplaceSessionAsync(session);

        // Tell everyone the old socket is gone before announcing the new one
        if (oldSocketId is not null)
        {
            await hub.Clients.All.SendAsync("LobbyPlayerLeft", new { PlayerId = oldSocketId });
            if (session.PickOrder.Count > 0)
                await hub.Clients.All.SendAsync("PickerUpdate", BuildPickerDto(session));
        }
        else if (session.Status == "active" && session.PickOrder.Contains(socketId))
        {
            // Newly force-joined player: push updated pick order to everyone
            await hub.Clients.All.SendAsync("PickerUpdate", BuildPickerDto(session));
        }

        var game = await GetGame(session.GameId);
        await hub.Clients.Client(socketId).SendAsync("SessionState", BuildPublicState(session, game));
        var rejoined = session.Players.First(p => p.SocketId == socketId);
        await hub.Clients.All.SendAsync("LobbyPlayerJoined", new { Player = BuildPlayerDto(rejoined) });
    }

    // ── offline player setup ───────────────────────────────────────────────

    /// <summary>
    /// Replaces any existing offline-* virtual players in the lobby with a fresh set.
    /// Each input specifies the hardware key, display name, and color for the player.
    /// Only valid in lobby status.
    /// </summary>
    public async Task AddOfflinePlayers(List<OfflinePlayerInput> inputs)
    {
        var session = await GetActiveSession();
        if (session is null || session.Status != "lobby") return;

        // Remove existing offline players and notify everyone
        var existing = session.Players.Where(p => p.SocketId.StartsWith("offline-")).ToList();
        foreach (var p in existing)
        {
            session.Players.Remove(p);
            await hub.Clients.All.SendAsync("LobbyPlayerLeft", new { PlayerId = p.SocketId });
        }

        // Add new offline players
        foreach (var input in inputs)
        {
            var socketId = $"offline-{input.Key.ToUpperInvariant()}";
            session.Players.Add(new Player { SocketId = socketId, Name = input.Name, Color = input.Color });
        }

        await db.ReplaceSessionAsync(session);

        // Announce new players
        foreach (var p in session.Players.Where(p => p.SocketId.StartsWith("offline-")))
            await hub.Clients.All.SendAsync("LobbyPlayerJoined", new { Player = BuildPlayerDto(p) });
    }

    // ── start game ─────────────────────────────────────────────────────────

    public async Task StartGame()
    {
        var session = await GetActiveSession();
        if (session is null || session.Status != "lobby") return;

        session.Status = "active";
        session.PickOrder = session.Players.OrderBy(_ => Random.Shared.Next()).Select(p => p.SocketId).ToList();
        session.CurrentPickerIndex = 0;
        await db.ReplaceSessionAsync(session);
        await hub.Clients.All.SendAsync("GameStarted");
        await hub.Clients.All.SendAsync("PickerUpdate", BuildPickerDto(session));
    }

    // ── open card ──────────────────────────────────────────────────────────

    public async Task OpenCard(string cardId)
    {
        var session = await GetActiveSession();
        if (session is null || session.Status != "active") return;

        var game = await GetGame(session.GameId);
        var card = game?.Cards.FirstOrDefault(c => c.Id == cardId);
        if (card is null) return;

        var playedInCard = session.PlayedSongs
            .Where(p => p.CardId == cardId)
            .Select(p => p.SongIndex)
            .ToHashSet();

        var songIndex = Enumerable.Range(0, card.Songs.Count).FirstOrDefault(i => !playedInCard.Contains(i), -1);
        if (songIndex == -1) return;

        session.CurrentRound = new CurrentRound
        {
            CardId = cardId,
            SongIndex = songIndex,
            Phase = "guess",
            ExhaustedBuzzers = new()
        };
        await db.ReplaceSessionAsync(session);

        var song = card.Songs[songIndex];
        var startPct = CalcStartPercent(song);

        var videoUrl = song.LocalVideoUrl ?? song.VideoUrl;

        // Display gets video URL + start position; others get start position only
        await hub.Clients.Group("display").SendAsync("RoundSongStart", new
        {
            CardId = cardId, CardLabel = card.Label, Stars = card.Stars,
            SongIndex = songIndex, TotalSongs = card.Songs.Count, VideoUrl = videoUrl,
            ClipDuration = game.Settings.ClipDuration, StartPercent = startPct
        });
        await hub.Clients.Group("players").SendAsync("RoundSongStart", new
        {
            CardId = cardId, CardLabel = card.Label, Stars = card.Stars,
            SongIndex = songIndex, TotalSongs = card.Songs.Count, VideoUrl = "",
            ClipDuration = game.Settings.ClipDuration, StartPercent = startPct
        });
        await hub.Clients.Group("host").SendAsync("RoundSongStart", new
        {
            CardId = cardId, CardLabel = card.Label, Stars = card.Stars,
            SongIndex = songIndex, TotalSongs = card.Songs.Count, VideoUrl = "",
            ClipDuration = game.Settings.ClipDuration, StartPercent = startPct
        });

        // Answer hint only to host
        await hub.Clients.Group("host").SendAsync("RoundAnswerHint", new
        {
            song.AnimeName, song.SongName, song.SongArtist
        });
    }

    // ── buzz ───────────────────────────────────────────────────────────────

    public async Task TimeUp()
    {
        var session = await GetActiveSession();
        if (session?.CurrentRound is null || session.CurrentRound.Phase != "guess") return;
        if (session.CurrentRound.IsTimedOut) return;

        session.CurrentRound.IsTimedOut = true;
        await db.ReplaceSessionAsync(session);
        await hub.Clients.All.SendAsync("RoundTimedOut");
    }

    public async Task Buzz(string socketId)
    {
        var session = await GetActiveSession();
        if (session?.CurrentRound is null || session.CurrentRound.Phase != "guess") return;
        if (session.CurrentRound.IsTimedOut) return;

        var player = session.Players.FirstOrDefault(p => p.SocketId == socketId);
        if (player is null) return;
        if (session.CurrentRound.ExhaustedBuzzers.Contains(socketId)) return;

        session.CurrentRound.Phase = "buzzed";
        session.CurrentRound.BuzzedPlayerId = socketId;
        await db.ReplaceSessionAsync(session);

        var game = await GetGame(session.GameId);
        await hub.Clients.All.SendAsync("RoundBuzz", new
        {
            Player = new { player.SocketId, player.Name, player.Color },
            BuzzTimerSeconds = game?.Settings.BuzzTimerSeconds ?? 30,
        });
        await hub.Clients.Group("display").SendAsync("RoundAudioPause");
    }

    // ── judge ──────────────────────────────────────────────────────────────

    public async Task Judge(bool correct)
    {
        var session = await GetActiveSession();
        if (session?.CurrentRound is null) return;

        var game = await GetGame(session.GameId);
        var round = session.CurrentRound;
        var card = game?.Cards.FirstOrDefault(c => c.Id == round.CardId);
        if (card is null) return;

        var song = card.Songs[round.SongIndex];
        var pointValue = game!.Settings.StarPointMap.GetValueOrDefault(card.Stars, card.Stars * 100);

        if (correct)
        {
            var winner = session.Players.FirstOrDefault(p => p.SocketId == round.BuzzedPlayerId);
            var effectivePoints = (round.BuzzedPlayerId is not null && round.BuzzedPlayerId == session.CurrentPickerId)
                ? pointValue * 2
                : pointValue;
            if (winner is not null) winner.Score += effectivePoints;
            await db.ReplaceSessionAsync(session);
            await RevealAndAdvance(session, game, card, song, effectivePoints, round.BuzzedPlayerId);
        }
        else
        {
            var loser = session.Players.FirstOrDefault(p => p.SocketId == round.BuzzedPlayerId);
            if (loser is not null && game.Settings.WrongAnswerDeduction > 0)
                loser.Score -= game.Settings.WrongAnswerDeduction;

            round.ExhaustedBuzzers.Add(round.BuzzedPlayerId!);
            round.BuzzedPlayerId = null;
            round.Phase = "guess";

            bool allExhausted = session.Players.All(p => round.ExhaustedBuzzers.Contains(p.SocketId));
            if (allExhausted) round.IsTimedOut = true;

            await db.ReplaceSessionAsync(session);

            await hub.Clients.All.SendAsync("ScoresUpdate", BuildScores(session.Players));
            await hub.Clients.All.SendAsync("RoundAudioResume");

            // All players exhausted — let audience try; host reveals when ready
            if (allExhausted)
                await hub.Clients.All.SendAsync("RoundTimedOut");
        }
    }

    // ── skip ───────────────────────────────────────────────────────────────

    public async Task Skip()
    {
        var session = await GetActiveSession();
        if (session?.CurrentRound is null) return;
        var game = await GetGame(session.GameId);
        var card = game?.Cards.FirstOrDefault(c => c.Id == session.CurrentRound.CardId);
        if (card is null) return;
        var song = card.Songs[session.CurrentRound.SongIndex];
        await RevealAndAdvance(session, game!, card, song, 0, null);
    }

    // ── kick player ────────────────────────────────────────────────────────

    public async Task KickPlayer(string playerId)
    {
        var session = await GetActiveSession();
        if (session is null) return;

        var player = session.Players.FirstOrDefault(p => p.SocketId == playerId);
        if (player is null) return;

        player.BannedUntil = DateTime.UtcNow.AddSeconds(30);
        await db.ReplaceSessionAsync(session);

        await hub.Clients.Client(playerId).SendAsync("LobbyPlayerKicked");
        await hub.Clients.All.SendAsync("LobbyPlayerLeft", new { PlayerId = playerId });
    }

    // ── set picker (host manual override) ─────────────────────────────────

    public async Task SetPicker(string playerId)
    {
        var session = await GetActiveSession();
        if (session is null) return;
        var idx = session.PickOrder.IndexOf(playerId);
        if (idx == -1) return;
        session.CurrentPickerIndex = idx;
        await db.ReplaceSessionAsync(session);
        await hub.Clients.All.SendAsync("PickerUpdate", BuildPickerDto(session));
    }

    // ── set score (host manual override) ──────────────────────────────────

    public async Task SetScore(string playerId, int score)
    {
        var session = await GetActiveSession();
        if (session is null) return;

        var player = session.Players.FirstOrDefault(p => p.SocketId == playerId);
        if (player is null) return;

        player.Score = score;
        await db.ReplaceSessionAsync(session);
        await hub.Clients.All.SendAsync("ScoresUpdate", BuildScores(session.Players));
    }

    // ── end game ───────────────────────────────────────────────────────────

    public async Task EndGame()
    {
        var session = await GetActiveSession();
        if (session is null) return;

        session.Status = "ended";
        session.CurrentRound = null;
        await db.ReplaceSessionAsync(session);

        await hub.Clients.All.SendAsync("GameEnded", new
        {
            FinalScores = session.Players.Select(BuildPlayerDto)
        });
    }

    // ── player disconnect ──────────────────────────────────────────────────

    public async Task PlayerDisconnect(string socketId)
    {
        var session = await GetActiveSession();
        if (session is null) return;

        var player = session.Players.FirstOrDefault(p => p.SocketId == socketId);
        if (player is null || player.BannedUntil > DateTime.UtcNow) return;

        session.Players.Remove(player);
        await db.ReplaceSessionAsync(session);
        await hub.Clients.All.SendAsync("LobbyPlayerLeft", new { PlayerId = socketId });
    }

    // ── reveal (no auto-advance — host calls NextSong when ready) ─────────────

    private async Task RevealAndAdvance(Session session, Game game, Card card, SongEntry song, int points, string? winnerId)
    {
        var round = session.CurrentRound!;
        round.Phase = "reveal";
        session.PlayedSongs.Add(new PlayedSong { CardId = round.CardId, SongIndex = round.SongIndex });
        await db.ReplaceSessionAsync(session);

        await hub.Clients.All.SendAsync("RoundAnswerReveal", new
        {
            song.AnimeName, song.SongName, song.SongArtist,
            PointsAwarded = points, WinnerId = winnerId,
            VideoUrl = song.LocalVideoUrl ?? song.VideoUrl
        });
        await hub.Clients.All.SendAsync("ScoresUpdate", BuildScores(session.Players));
        await hub.Clients.All.SendAsync("CardsUpdate", new { Cards = BuildCardSummaries(session, game) });

        // Preload the next song on all display screens while host reviews the answer.
        // AllDisplaysReady is sent to the host once every display confirms the buffer is ready.
        var playedInThisCard = session.PlayedSongs
            .Where(p => p.CardId == round.CardId)
            .Select(p => p.SongIndex)
            .ToHashSet();
        var nextIdx = Enumerable.Range(0, card.Songs.Count)
            .Cast<int?>()
            .FirstOrDefault(i => !playedInThisCard.Contains(i!.Value));
        var preloadUrl = nextIdx.HasValue
            ? (card.Songs[nextIdx.Value].LocalVideoUrl ?? card.Songs[nextIdx.Value].VideoUrl)
            : null;
        await StartPreload(preloadUrl);
    }

    // ── next song (host-triggered after reveal) ────────────────────────────

    public async Task NextSong()
    {
        var session = await GetActiveSession();
        if (session?.CurrentRound is null || session.CurrentRound.Phase != "reveal") return;

        var game = await GetGame(session.GameId);
        var round = session.CurrentRound;
        var card = game?.Cards.FirstOrDefault(c => c.Id == round.CardId);
        if (card is null) return;

        var playedInCard = session.PlayedSongs
            .Where(p => p.CardId == round.CardId)
            .Select(p => p.SongIndex)
            .ToHashSet();

        var nextIndex = Enumerable.Range(0, card.Songs.Count).Cast<int?>()
            .FirstOrDefault(i => !playedInCard.Contains(i!.Value));

        if (nextIndex.HasValue)
        {
            session.CurrentRound = new CurrentRound
            {
                CardId = round.CardId,
                SongIndex = nextIndex.Value,
                Phase = "guess",
                ExhaustedBuzzers = new()
            };
            await db.ReplaceSessionAsync(session);

            var nextSong = card.Songs[nextIndex.Value];
            var nextStartPct = CalcStartPercent(nextSong);
            var nextVideoUrl = nextSong.LocalVideoUrl ?? nextSong.VideoUrl;
            await hub.Clients.Group("display").SendAsync("RoundSongStart", new
            {
                CardId = round.CardId, CardLabel = card.Label, Stars = card.Stars,
                SongIndex = nextIndex.Value, TotalSongs = card.Songs.Count, VideoUrl = nextVideoUrl,
                ClipDuration = game!.Settings.ClipDuration, StartPercent = nextStartPct
            });
            await hub.Clients.Group("players").SendAsync("RoundSongStart", new
            {
                CardId = round.CardId, CardLabel = card.Label, Stars = card.Stars,
                SongIndex = nextIndex.Value, TotalSongs = card.Songs.Count, VideoUrl = "",
                ClipDuration = game!.Settings.ClipDuration, StartPercent = nextStartPct
            });
            await hub.Clients.Group("host").SendAsync("RoundSongStart", new
            {
                CardId = round.CardId, CardLabel = card.Label, Stars = card.Stars,
                SongIndex = nextIndex.Value, TotalSongs = card.Songs.Count, VideoUrl = "",
                ClipDuration = game!.Settings.ClipDuration, StartPercent = nextStartPct
            });
            await hub.Clients.Group("host").SendAsync("RoundAnswerHint", new
            {
                nextSong.AnimeName, nextSong.SongName, nextSong.SongArtist
            });
        }
        else
        {
            session.CurrentRound = null;
            if (session.PickOrder.Count > 0)
                session.CurrentPickerIndex = (session.CurrentPickerIndex + 1) % session.PickOrder.Count;
            await db.ReplaceSessionAsync(session);
            await hub.Clients.All.SendAsync("RoundCardComplete");
            await hub.Clients.All.SendAsync("PickerUpdate", BuildPickerDto(session));
        }
    }

    // ── helpers ────────────────────────────────────────────────────────────

    private static object BuildPickerDto(Session session) => new
    {
        CurrentPickerId = session.CurrentPickerId,
        PickOrder = session.PickOrder,
    };

    private static IEnumerable<object> BuildCardSummaries(Session session, Game game)
    {
        var playedSet = session.PlayedSongs
            .Select(p => $"{p.CardId}-{p.SongIndex}")
            .ToHashSet();
        return game.Cards.Select(c => (object)new
        {
            c.Id, c.Label, c.Stars,
            TotalSongs = c.Songs.Count,
            PlayedCount = Enumerable.Range(0, c.Songs.Count).Count(i => playedSet.Contains($"{c.Id}-{i}"))
        });
    }

    private static int CalcStartPercent(SongEntry song)
    {
        if (song.StartMin >= song.StartMax) return song.StartMin;
        return Random.Shared.Next(song.StartMin, song.StartMax + 1);
    }

    // ── public state ───────────────────────────────────────────────────────

    public static object? BuildPublicState(Session? session, Game? game)
    {
        if (session is null || game is null) return null;

        var cards = BuildCardSummaries(session, game);

        object? currentRound = null;
        if (session.CurrentRound is { } r)
        {
            var card = game.Cards.FirstOrDefault(c => c.Id == r.CardId);
            var buzzed = r.BuzzedPlayerId is not null
                ? session.Players.FirstOrDefault(p => p.SocketId == r.BuzzedPlayerId)
                : null;
            currentRound = new
            {
                r.CardId,
                CardLabel = card?.Label ?? "",
                Stars = card?.Stars ?? 1,
                r.SongIndex,
                TotalSongs = card?.Songs.Count ?? 0,
                r.Phase,
                BuzzedPlayer = buzzed is null ? null : new { buzzed.SocketId, buzzed.Name, buzzed.Color },
                r.ExhaustedBuzzers
            };
        }

        return new
        {
            SessionId = session.Id,
            session.Status,
            Players = session.Players.Select(BuildPlayerDto),
            Cards = cards,
            CurrentRound = currentRound,
            CurrentPickerId = session.CurrentPickerId,
            PickOrder = session.PickOrder,
            IsLocalized = game.IsLocalized,
        };
    }
}
