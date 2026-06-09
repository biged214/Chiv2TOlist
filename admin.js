let tiers = [
  { id: "s", label: "S", name: "", color: "#7f1d1d" },
  { id: "a", label: "A", name: "", color: "#9b5d1f" },
  { id: "b", label: "B", name: "", color: "#50683e" },
  { id: "c", label: "C", name: "", color: "#536673" },
  { id: "watch", label: "D", name: "", color: "#4c3b62" }
];
let players = [];
let isAdmin = false;

const playerForm = document.querySelector("#playerForm");
const playerId = document.querySelector("#playerId");
const playerName = document.querySelector("#playerName");
const playerTier = document.querySelector("#playerTier");
const playerRegion = document.querySelector("#playerRegion");
const playerRole = document.querySelector("#playerRole");
const playerClan = document.querySelector("#playerClan");
const playerPlayfabId = document.querySelector("#playerPlayfabId");
const playerNotes = document.querySelector("#playerNotes");
const adminList = document.querySelector("#adminList");
const adminWorkspace = document.querySelector("#adminWorkspace");
const adminLock = document.querySelector("#adminLock");

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Request failed." }));
    throw new Error(error.error || "Request failed.");
  }

  return response.json();
}

function byOrder(a, b) {
  return a.order - b.order || a.name.localeCompare(b.name);
}

function populateTierSelect() {
  const selectedTier = playerTier.value;
  playerTier.innerHTML = "";
  tiers.forEach((tier) => {
    const label = tier.name ? `${tier.label} - ${tier.name}` : tier.label;
    playerTier.append(new Option(label, tier.id));
  });
  playerTier.value = tiers.some((tier) => tier.id === selectedTier) ? selectedTier : tiers[2]?.id || "b";
}

function renderAdminList() {
  adminList.innerHTML = "";
  players.slice().sort(byOrder).forEach((player, index) => {
    const tier = tiers.find((item) => item.id === player.tier);
    const item = document.createElement("article");
    item.className = "admin-item";
    item.innerHTML = `
      <div>
        <strong>${escapeHtml(player.name)}</strong>
        <span>${escapeHtml(tier?.label || player.tier)} tier - ${escapeHtml(player.region || "Unknown region")} - ${escapeHtml(player.role || "Flexible")}${player.playfabId ? " - Stats linked" : ""}</span>
      </div>
      <div class="admin-actions">
        <button class="mini-button" type="button" data-action="up" data-id="${player.id}" title="Move up">Up</button>
        <button class="mini-button" type="button" data-action="down" data-id="${player.id}" title="Move down">Down</button>
        <button class="mini-button" type="button" data-action="edit" data-id="${player.id}">Edit</button>
        <button class="mini-button" type="button" data-action="delete" data-id="${player.id}">Delete</button>
      </div>
    `;
    item.querySelector('[data-action="up"]').disabled = index === 0;
    item.querySelector('[data-action="down"]').disabled = index === players.length - 1;
    adminList.append(item);
  });
}

function clearForm() {
  playerForm.reset();
  playerId.value = "";
  playerTier.value = tiers[2]?.id || tiers[0]?.id || "b";
}

async function refreshPlayers() {
  players = await api("/api/players");
  renderAdminList();
}

async function savePlayer(event) {
  event.preventDefault();
  const body = {
    name: playerName.value.trim(),
    tier: playerTier.value,
    region: playerRegion.value.trim(),
    role: playerRole.value.trim(),
    clan: playerClan.value.trim(),
    playfabId: playerPlayfabId.value.trim(),
    notes: playerNotes.value.trim()
  };

  if (playerId.value) {
    await api(`/api/players/${encodeURIComponent(playerId.value)}`, {
      method: "PUT",
      body: JSON.stringify(body)
    });
  } else {
    await api("/api/players", {
      method: "POST",
      body: JSON.stringify(body)
    });
  }

  clearForm();
  await refreshPlayers();
}

playerForm.addEventListener("submit", (event) => {
  savePlayer(event).catch((error) => alert(error.message));
});

adminList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const { action, id } = button.dataset;
  const player = players.find((item) => item.id === id);

  if (action === "edit" && player) {
    playerId.value = player.id;
    playerName.value = player.name;
    playerTier.value = player.tier;
    playerRegion.value = player.region;
    playerRole.value = player.role;
    playerClan.value = player.clan;
    playerPlayfabId.value = player.playfabId || "";
    playerNotes.value = player.notes;
    playerName.focus();
  }

  if (action === "delete" && player && confirm(`Delete ${player.name}?`)) {
    api(`/api/players/${encodeURIComponent(id)}`, { method: "DELETE" })
      .then(refreshPlayers)
      .catch((error) => alert(error.message));
  }

  if (action === "up" || action === "down") {
    api("/api/players/reorder", {
      method: "POST",
      body: JSON.stringify({ id, direction: action })
    })
      .then((nextPlayers) => {
        players = nextPlayers;
        renderAdminList();
      })
      .catch((error) => alert(error.message));
  }
});

document.querySelector("#unlockAdmin").addEventListener("click", async () => {
  try {
    await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ password: document.querySelector("#adminCode").value })
    });
    isAdmin = true;
    adminLock.hidden = true;
    adminWorkspace.hidden = false;
    await refreshPlayers();
  } catch (error) {
    alert(error.message);
  }
});

document.querySelector("#clearForm").addEventListener("click", clearForm);

document.querySelector("#resetDemo").addEventListener("click", async () => {
  if (!isAdmin) {
    alert("Unlock admin controls first.");
    return;
  }

  if (!confirm("Reset the tier list back to the demo players?")) return;
  players = await api("/api/players/reset", { method: "POST" });
  renderAdminList();
});

document.querySelector("#exportData").addEventListener("click", async () => {
  const data = JSON.stringify(players.slice().sort(byOrder), null, 2);
  try {
    await navigator.clipboard.writeText(data);
    alert("Tier list data copied to your clipboard.");
  } catch {
    prompt("Copy your tier list data:", data);
  }
});

async function init() {
  await api("/api/logout", { method: "POST" }).catch(() => null);
  isAdmin = false;
  players = await api("/api/players");
  populateTierSelect();
  adminLock.hidden = false;
  adminWorkspace.hidden = true;
  clearForm();
}

init().catch((error) => {
  const message =
    window.location.protocol === "file:"
      ? "Open this page through the local server at http://localhost:3000/admin so it can load player data."
      : error.message;
  adminLock.hidden = false;
  adminWorkspace.hidden = true;
  adminLock.insertAdjacentHTML("beforeend", `<p class="hint">${escapeHtml(message)}</p>`);
});
