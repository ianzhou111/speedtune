using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;
using SpeedTune.Api.Hubs;
using SpeedTune.Api.Services;

var builder = WebApplication.CreateBuilder(args);

// ── Configuration ───────────────────────────────────────────────────────────
// Values can come from appsettings.json, environment variables, or user-secrets.
// Environment variable format: MongoDB__Uri  /  Jwt__Key  (double-underscore = colon)

var jwtKey = builder.Configuration["Jwt:Key"]
    ?? throw new Exception("Jwt:Key is not configured. Set it in appsettings or env var Jwt__Key.");

// ── Services ────────────────────────────────────────────────────────────────

builder.Services.AddSingleton<MongoDbService>();
builder.Services.AddSingleton<GameEngineService>();

builder.Services.AddHttpClient();

builder.Services.AddControllers()
    .AddJsonOptions(opts => opts.JsonSerializerOptions.PropertyNamingPolicy = null);

// SignalR — use null NamingPolicy so payloads match PascalCase TypeScript types
builder.Services.AddSignalR()
    .AddJsonProtocol(opts =>
        opts.PayloadSerializerOptions.PropertyNamingPolicy = null);

// JWT Authentication
builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(opts =>
    {
        opts.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer           = true,
            ValidateAudience         = true,
            ValidateLifetime         = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer              = builder.Configuration["Jwt:Issuer"] ?? "speedtune",
            ValidAudience            = builder.Configuration["Jwt:Audience"] ?? "speedtune",
            IssuerSigningKey         = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey))
        };

        // Allow token via ?access_token= query string (required for SignalR)
        opts.Events = new JwtBearerEvents
        {
            OnMessageReceived = ctx =>
            {
                var token = ctx.Request.Query["access_token"].ToString();
                if (!string.IsNullOrEmpty(token) &&
                    ctx.HttpContext.Request.Path.StartsWithSegments("/hub"))
                {
                    ctx.Token = token;
                }
                return Task.CompletedTask;
            }
        };
    });

builder.Services.AddAuthorization();

// CORS – allow the Vite dev server and any production origin
var frontendOrigins = builder.Configuration["Frontend:Origins"]?.Split(',')
    ?? ["http://localhost:5173"];

builder.Services.AddCors(opts =>
    opts.AddDefaultPolicy(policy =>
        policy
            .WithOrigins(frontendOrigins)
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials()));  // required for SignalR long-polling fallback

// ── Pipeline ────────────────────────────────────────────────────────────────

var app = builder.Build();

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();
app.MapHub<GameHub>("/hub");

app.Run();
