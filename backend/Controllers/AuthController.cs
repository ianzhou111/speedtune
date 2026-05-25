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
    private const string HardcodedUsername = "admin";
    private const string HardcodedPassword = "12345";

    [HttpPost("login")]
    public IActionResult Login([FromBody] LoginRequest req)
    {
        if (req.Username != HardcodedUsername || req.Password != HardcodedPassword)
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
            claims: [new Claim(ClaimTypes.Name, HardcodedUsername), new Claim(ClaimTypes.Role, "admin")],
            expires: DateTime.UtcNow.AddDays(7),
            signingCredentials: creds);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}

public record LoginRequest(string Username, string Password);
