using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.Tokens;
using MongoDB.Driver;
using SpeedTune.Api.Models;
using SpeedTune.Api.Services;

namespace SpeedTune.Api.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController(IConfiguration config, MongoDbService db) : ControllerBase
{
    // ── Register ────────────────────────────────────────────────────────────

    [HttpPost("register")]
    public async Task<IActionResult> Register([FromBody] RegisterRequest req)
    {
        // 1. Validate invite code
        var expectedCode = config["Admin:RegistrationCode"]
            ?? throw new Exception("Admin:RegistrationCode is not configured.");

        if (req.RegistrationCode != expectedCode)
            return Unauthorized(new { message = "Invalid registration code." });

        // 2. Enforce username constraints
        if (string.IsNullOrWhiteSpace(req.Username) || req.Username.Length < 3)
            return BadRequest(new { message = "Username must be at least 3 characters." });

        if (string.IsNullOrWhiteSpace(req.Password) || req.Password.Length < 6)
            return BadRequest(new { message = "Password must be at least 6 characters." });

        // 3. Check uniqueness (case-insensitive)
        var exists = await db.AdminUsers
            .Find(u => u.Username.ToLower() == req.Username.ToLower())
            .AnyAsync();
        if (exists)
            return Conflict(new { message = "Username already taken." });

        // 4. Hash & store
        var user = new AdminUser
        {
            Username     = req.Username.Trim(),
            PasswordHash = HashPassword(req.Password),
            CreatedAt    = DateTime.UtcNow,
        };
        await db.AdminUsers.InsertOneAsync(user);

        return Ok(new { token = GenerateJwt(user.Username) });
    }

    // ── Login ───────────────────────────────────────────────────────────────

    [HttpPost("login")]
    public async Task<IActionResult> Login([FromBody] LoginRequest req)
    {
        // Look up in MongoDB first
        var user = await db.AdminUsers
            .Find(u => u.Username.ToLower() == req.Username.ToLower())
            .FirstOrDefaultAsync();

        if (user is not null)
        {
            if (!VerifyPassword(req.Password, user.PasswordHash))
                return Unauthorized(new { message = "Invalid credentials." });

            return Ok(new { token = GenerateJwt(user.Username) });
        }

        // No DB account found
        return Unauthorized(new { message = "Invalid credentials." });
    }

    [HttpPost("logout")]
    public IActionResult Logout() => Ok();

    // ── JWT ─────────────────────────────────────────────────────────────────

    private string GenerateJwt(string username)
    {
        var key      = config["Jwt:Key"] ?? throw new Exception("Jwt:Key not configured");
        var issuer   = config["Jwt:Issuer"]   ?? "speedtune";
        var audience = config["Jwt:Audience"] ?? "speedtune";

        var creds = new SigningCredentials(
            new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key)),
            SecurityAlgorithms.HmacSha256);

        var token = new JwtSecurityToken(
            issuer:            issuer,
            audience:          audience,
            claims:            [new Claim(ClaimTypes.Name, username), new Claim(ClaimTypes.Role, "admin")],
            expires:           DateTime.UtcNow.AddDays(7),
            signingCredentials: creds);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    // ── Password hashing (PBKDF2-SHA256, no extra packages) ─────────────────

    private static string HashPassword(string password)
    {
        byte[] salt = RandomNumberGenerator.GetBytes(16);
        byte[] hash = Rfc2898DeriveBytes.Pbkdf2(
            password, salt, iterations: 100_000,
            HashAlgorithmName.SHA256, outputLength: 32);
        return $"{Convert.ToBase64String(salt)}:{Convert.ToBase64String(hash)}";
    }

    private static bool VerifyPassword(string password, string stored)
    {
        var parts = stored.Split(':');
        if (parts.Length != 2) return false;
        byte[] salt         = Convert.FromBase64String(parts[0]);
        byte[] expectedHash = Convert.FromBase64String(parts[1]);
        byte[] actualHash   = Rfc2898DeriveBytes.Pbkdf2(
            password, salt, iterations: 100_000,
            HashAlgorithmName.SHA256, outputLength: 32);
        return CryptographicOperations.FixedTimeEquals(actualHash, expectedHash);
    }
}

public record LoginRequest(string Username, string Password);
public record RegisterRequest(string Username, string Password, string RegistrationCode);
