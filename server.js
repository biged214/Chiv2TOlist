import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 3000;
const adminPassword = process.env.ADMIN_PASSWORD || "mason-order";
const sessionSecret = process.env.SESSION_SECRET || "change-this-session-secret";
const cookieName = "chiv2_admin";
const dataDir = path.join(__dirname, "data");
const playersFile = path.join(dataDir, "players.json");

const tiers = [
  { id: "s", label: "S", name: "", color: "#7f1d1d" },
  { id: "a", label: "A", name: "", color: "#9b5d1f" },
  { id: "b", label: "B", name: "", color: "#50683e" },
  { id: "c", label: "C", name: "", color: "#536673" },
  { id: "watch", label: "D", name: "", color: "#4c3b62" }
];

const starterPlayers = [
  {
    id: crypto.randomUUID(),
    name: "Sir Objective",
    tier: "s",
    region: "NA East",
    role: "Frontline",
    clan: "Free Agent",
    notes: "Always on carts, gates, banners, and overtime fights.",
    order: 1
  },
  {
    id: crypto.randomUUID(),
    name: "Banner Breaker",
    tier: "a",
    region: "EU",
    role: "Knight",
    clan: "Mason",
    notes: "Strong anchor player with consistent pressure on final objectives.",
    order: 2
  },
  {
    id: crypto.randomUUID(),
    name: "Supply Crate",
    tier: "b",
    region: "NA Central",
    role: "Engineer",
    clan: "Agatha",
    notes: "Builds, repairs, and plays the boring jobs that win maps.",
    order: 3
  },
  {
    id: crypto.randomUUID(),
    name: "Ladder Lord",
    tier: "watch",
    region: "OCE",
    role: "Vanguard",
    clan: "",
    notes: "Explosive pushes, needs more matches against top groups.",
    order: 4
  }
];

app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname));

function parseCookies(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [name, ...value] = part.split("=");
        return [decodeURIComponent(name), decodeURIComponent(value.join("="))];
      })
  );
}

function sign(value) {
  return crypto.createHmac("sha256", sessionSecret).update(value).digest("base64url");
}

function makeSession() {
  const payload = JSON.stringify({ role: "admin", exp: Date.now() + 1000 * 60 * 60 * 12 });
  const encoded = Buffer.from(payload).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

function isValidSession(token) {
  if (!token || !token.includes(".")) return false;
  const [encoded, signature] = token.split(".");
  if (signature !== sign(encoded)) return false;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    return payload.role === "admin" && payload.exp > Date.now();
  } catch {
    return false;
  }
}

function requireAdmin(request, response, next) {
  const cookies = parseCookies(request.headers.cookie);
  if (!isValidSession(cookies[cookieName])) {
    response.status(401).json({ error: "Admin login required." });
    return;
  }

  next();
}

function normalizePlayer(input, fallback = {}) {
  return {
    id: fallback.id || input.id || crypto.randomUUID(),
    name: String(input.name || fallback.name || "").trim().slice(0, 40),
    tier: tiers.some((tier) => tier.id === input.tier) ? input.tier : fallback.tier || "b",
    region: String(input.region || fallback.region || "").trim().slice(0, 24),
    role: String(input.role || fallback.role || "").trim().slice(0, 28),
    clan: String(input.clan || fallback.clan || "").trim().slice(0, 28),
    notes: String(input.notes || fallback.notes || "").trim().slice(0, 180),
    order: Number.isFinite(Number(input.order)) ? Number(input.order) : fallback.order || 1
  };
}

async function readPlayers() {
  try {
    const raw = await fs.readFile(playersFile, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((player) => normalizePlayer(player)).sort(byOrder) : starterPlayers;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writePlayers(starterPlayers);
    return starterPlayers;
  }
}

async function writePlayers(players) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(playersFile, `${JSON.stringify(players.sort(byOrder), null, 2)}\n`);
}

function byOrder(a, b) {
  return a.order - b.order || a.name.localeCompare(b.name);
}

app.get("/api/config", (_request, response) => {
  response.json({ tiers });
});

app.get("/api/players", async (_request, response, next) => {
  try {
    response.json(await readPlayers());
  } catch (error) {
    next(error);
  }
});

app.get("/api/session", (request, response) => {
  const cookies = parseCookies(request.headers.cookie);
  response.json({ isAdmin: isValidSession(cookies[cookieName]) });
});

app.post("/api/login", (request, response) => {
  if (request.body?.password !== adminPassword) {
    response.status(401).json({ error: "Wrong admin code." });
    return;
  }

  response.cookie(cookieName, makeSession(), {
    httpOnly: true,
    sameSite: "lax",
    secure: request.secure || request.headers["x-forwarded-proto"] === "https",
    maxAge: 1000 * 60 * 60 * 12
  });
  response.json({ ok: true });
});

app.post("/api/logout", (_request, response) => {
  response.clearCookie(cookieName);
  response.json({ ok: true });
});

app.post("/api/players", requireAdmin, async (request, response, next) => {
  try {
    const players = await readPlayers();
    const nextPlayer = normalizePlayer({
      ...request.body,
      order: players.length ? Math.max(...players.map((player) => player.order)) + 1 : 1
    });

    if (!nextPlayer.name) {
      response.status(400).json({ error: "Player name is required." });
      return;
    }

    players.push(nextPlayer);
    await writePlayers(players);
    response.status(201).json(nextPlayer);
  } catch (error) {
    next(error);
  }
});

app.put("/api/players/:id", requireAdmin, async (request, response, next) => {
  try {
    const players = await readPlayers();
    const existing = players.find((player) => player.id === request.params.id);
    if (!existing) {
      response.status(404).json({ error: "Player not found." });
      return;
    }

    const updated = normalizePlayer(request.body, existing);
    if (!updated.name) {
      response.status(400).json({ error: "Player name is required." });
      return;
    }

    const nextPlayers = players.map((player) => (player.id === existing.id ? updated : player));
    await writePlayers(nextPlayers);
    response.json(updated);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/players/:id", requireAdmin, async (request, response, next) => {
  try {
    const players = await readPlayers();
    await writePlayers(players.filter((player) => player.id !== request.params.id));
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/players/reorder", requireAdmin, async (request, response, next) => {
  try {
    const players = await readPlayers();
    const sorted = players.sort(byOrder);
    const currentIndex = sorted.findIndex((player) => player.id === request.body?.id);
    const targetIndex = request.body?.direction === "up" ? currentIndex - 1 : currentIndex + 1;

    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= sorted.length) {
      response.json(sorted);
      return;
    }

    [sorted[currentIndex].order, sorted[targetIndex].order] = [sorted[targetIndex].order, sorted[currentIndex].order];
    await writePlayers(sorted);
    response.json(sorted);
  } catch (error) {
    next(error);
  }
});

app.post("/api/players/import", requireAdmin, async (request, response, next) => {
  try {
    const nextPlayers = Array.isArray(request.body?.players)
      ? request.body.players.map((player, index) => normalizePlayer({ ...player, order: index + 1 }))
      : [];
    await writePlayers(nextPlayers);
    response.json(nextPlayers);
  } catch (error) {
    next(error);
  }
});

app.post("/api/players/reset", requireAdmin, async (_request, response, next) => {
  try {
    const nextPlayers = starterPlayers.map((player, index) => ({
      ...player,
      id: `demo-${player.name.toLowerCase().replaceAll(" ", "-")}`,
      order: index + 1
    }));
    await writePlayers(nextPlayers);
    response.json(nextPlayers);
  } catch (error) {
    next(error);
  }
});

app.use((request, response) => {
  if (request.path.startsWith("/api/")) {
    response.status(404).json({ error: "Not found." });
    return;
  }

  response.sendFile(path.join(__dirname, "index.html"));
});

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({ error: "Server error." });
});

app.listen(port, () => {
  console.log(`Chiv2 tier list server running on port ${port}`);
});
