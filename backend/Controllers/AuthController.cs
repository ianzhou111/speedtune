using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.Tokens;

namespace SpeedTune.Api.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController(IConfiguration config) : ControllerBase
{
    [HttpPost("login")]
    public IActionResult Login([FromBody] LoginRequest req)
    {
        var username = config["Admin:Username"] ?? "admin";
        var password = config["Admin:Password"]
            ?? throw new Exception("Admin:Password is not configured. Set env var Admin__Password.");

        if (req.Username != username || req.Password != password)
            return Unauthorized(new { message = "Invalid credentials" });

        var token = GenerateJwt();
        return Ok(new { token });
    }

    [HttpPost("logout")]
    public IActionResult Logout() => Ok();

    // ── helpers ────────────────────────────────────────────────────────────

    private string GenerateJwt()
    {
        var key = config["Jwt:Key"] ?? throw new Exception("Jwt:Key not configured");
        var issuer = config["Jwt:Issuer"] ?? "speedtune";
        var audience = config["Jwt:Audience"] ?? "speedtune";

        var creds = new SigningCredentials(
            new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key)),
            SecurityAlgorithms.HmacSha256);

        var token = new JwtSecurityToken(
            issuer: issuer,
            audience: audience,
            claims: [new Claim(ClaimTypes.Name, config["Admin:Username"] ?? "admin"), new Claim(ClaimTypes.Role, "admin")],
            expires: DateTime.UtcNow.AddDays(7),
            signingCredentials: creds);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}

public record LoginRequest(string Username, string Password);
