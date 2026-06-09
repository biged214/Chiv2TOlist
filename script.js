let tiers = [];
let players = [];
let isAdmin = false;

const tierBoard = document.querySelector("#tier-list");
const tierFilter = document.querySelector("#tierFilter");
const regionFilter = document.querySelector("#regionFilter");
const searchInput = document.querySelector("#searchInput");
const playerForm = document.querySelector("#playerForm");
const playerId = document.querySelector("#playerId");
const playerName = document.querySelector("#playerName");
const playerTier = document.querySelector("#playerTier");
const playerRegion = document.querySelector("#playerRegion");
const playerRole = document.querySelector("#playerRole");
const playerClan = document.querySelector("#playerClan");
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

function getFilters() {
  return {
    tier: tierFilter.value,
    region: regionFilter.value,
    search: searchInput.value.trim().toLowerCase()
  };
}

function visiblePlayers() {
  const filters = getFilters();
  return players.filter((player) => {
    const searchable = [player.name, player.region, player.role, player.clan, player.notes].join(" ").toLowerCase();
    const matchesTier = filters.tier === "all" || player.tier === filters.tier;
    const matchesRegion = filters.region === "all" || player.region === filters.region;
    const matchesSearch = !filters.search || searchable.includes(filters.search);
    return matchesTier && matchesRegion && matchesSearch;
  });
}

function populateControls() {
  const selectedTier = tierFilter.value;
  const selectedRegion = regionFilter.value;

  tierFilter.innerHTML = `<option value="all">All tiers</option>`;
  playerTier.innerHTML = "";

  tiers.forEach((tier) => {
    const label = tier.name ? `${tier.label} - ${tier.name}` : tier.label;
    tierFilter.append(new Option(label, tier.id));
    playerTier.append(new Option(label, tier.id));
  });

  tierFilter.value = tiers.some((tier) => tier.id === selectedTier) ? selectedTier : "all";

  const regions = [...new Set(players.map((player) => player.region).filter(Boolean))].sort();
  regionFilter.innerHTML = `<option value="all">All regions</option>`;
  regions.forEach((region) => regionFilter.append(new Option(region, region)));
  regionFilter.value = regions.includes(selectedRegion) ? selectedRegion : "all";
}

function renderTierBoard() {
  const filtered = visiblePlayers();
  tierBoard.innerHTML = "";

  tiers.forEach((tier) => {
    if (tierFilter.value !== "all" && tierFilter.value !== tier.id) return;

    const row = document.createElement("section");
    row.className = "tier-row";
    row.style.setProperty("--tier-color", tier.color);

    const label = document.createElement("div");
    label.className = "tier-label";
    label.innerHTML = `<div><strong>${escapeHtml(tier.label)}</strong><span>${escapeHtml(tier.name)}</span></div>`;

    const group = document.createElement("div");
    group.className = "tier-players";

    const tierPlayers = filtered.filter((player) => player.tier === tier.id).sort(byOrder);
    if (!tierPlayers.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No players in this tier yet.";
      group.append(empty);
    } else {
      tierPlayers.forEach((player) => group.append(renderPlayerCard(player)));
    }

    row.append(label, group);
    tierBoard.append(row);
  });
}

function renderPlayerCard(player) {
  const template = document.querySelector("#playerCardTemplate");
  const card = template.content.firstElementChild.cloneNode(true);
  const tier = tiers.find((item) => item.id === player.tier);
  card.querySelector("h3").textContent = player.name;
  card.querySelector(".badge").textContent = tier ? tier.label : player.tier;

  const meta = card.querySelector(".meta-list");
  [
    ["Region", player.region || "Unknown"],
    ["Role", player.role || "Flexible"],
    ["Team", player.clan || "None"]
  ].forEach(([label, value]) => {
    const item = document.createElement("div");
    item.innerHTML = `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`;
    meta.append(item);
  });

  card.querySelector("p").textContent = player.notes || "No notes yet.";
  return card;
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
        <span>${escapeHtml(tier?.label || player.tier)} tier - ${escapeHtml(player.region || "Unknown region")} - ${escapeHtml(player.role || "Flexible")}</span>
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

function render() {
  populateControls();
  renderTierBoard();
  if (isAdmin) renderAdminList();
}

function clearForm() {
  playerForm.reset();
  playerId.value = "";
  playerTier.value = tiers[2]?.id || tiers[0]?.id || "b";
}

async function refreshPlayers() {
  players = await api("/api/players");
  render();
}

async function savePlayer(event) {
  event.preventDefault();
  const body = {
    name: playerName.value.trim(),
    tier: playerTier.value,
    region: playerRegion.value.trim(),
    role: playerRole.value.trim(),
    clan: playerClan.value.trim(),
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
        render();
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
    render();
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
  render();
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

[tierFilter, regionFilter, searchInput].forEach((control) => {
  control.addEventListener("input", renderTierBoard);
});

async function init() {
  const [config, session, nextPlayers] = await Promise.all([
    api("/api/config"),
    api("/api/session"),
    api("/api/players")
  ]);
  tiers = config.tiers;
  isAdmin = session.isAdmin;
  players = nextPlayers;
  adminLock.hidden = isAdmin;
  adminWorkspace.hidden = !isAdmin;
  clearForm();
  render();
}

init().catch((error) => {
  tierBoard.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
});
