const storageKey = "chiv2-to-tier-list-v1";
const adminCode = "mason-order";

function makeId() {
  return crypto.randomUUID ? crypto.randomUUID() : `player-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const tiers = [
  { id: "s", label: "S", name: "", color: "#7f1d1d" },
  { id: "a", label: "A", name: "", color: "#9b5d1f" },
  { id: "b", label: "B", name: "", color: "#50683e" },
  { id: "c", label: "C", name: "", color: "#536673" },
  { id: "watch", label: "D", name: "", color: "#4c3b62" }
];

const starterPlayers = [
  {
    id: makeId(),
    name: "Sir Objective",
    tier: "s",
    region: "NA East",
    role: "Frontline",
    clan: "Free Agent",
    notes: "Always on carts, gates, banners, and overtime fights.",
    order: 1
  },
  {
    id: makeId(),
    name: "Banner Breaker",
    tier: "a",
    region: "EU",
    role: "Knight",
    clan: "Mason",
    notes: "Strong anchor player with consistent pressure on final objectives.",
    order: 2
  },
  {
    id: makeId(),
    name: "Supply Crate",
    tier: "b",
    region: "NA Central",
    role: "Engineer",
    clan: "Agatha",
    notes: "Builds, repairs, and plays the boring jobs that win maps.",
    order: 3
  },
  {
    id: makeId(),
    name: "Ladder Lord",
    tier: "watch",
    region: "OCE",
    role: "Vanguard",
    clan: "",
    notes: "Explosive pushes, needs more matches against top groups.",
    order: 4
  }
];

let players = loadPlayers();
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

function loadPlayers() {
  const saved = localStorage.getItem(storageKey);
  return saved ? JSON.parse(saved) : starterPlayers;
}

function savePlayers() {
  localStorage.setItem(storageKey, JSON.stringify(players));
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
  tierFilter.innerHTML = `<option value="all">All tiers</option>`;
  playerTier.innerHTML = "";

  tiers.forEach((tier) => {
    tierFilter.append(new Option(`${tier.label} - ${tier.name}`, tier.id));
    playerTier.append(new Option(`${tier.label} - ${tier.name}`, tier.id));
  });

  const selectedRegion = regionFilter.value;
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
    label.innerHTML = `<div><strong>${tier.label}</strong><span>${tier.name}</span></div>`;

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
    item.innerHTML = `<dt>${label}</dt><dd>${value}</dd>`;
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
        <span>${escapeHtml(tier?.label || player.tier)} tier · ${escapeHtml(player.region || "Unknown region")} · ${escapeHtml(player.role || "Flexible")}</span>
      </div>
      <div class="admin-actions">
        <button class="mini-button" type="button" data-action="up" data-id="${player.id}" title="Move up">↑</button>
        <button class="mini-button" type="button" data-action="down" data-id="${player.id}" title="Move down">↓</button>
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
  playerTier.value = "b";
}

function reorderPlayer(id, direction) {
  const sorted = players.slice().sort(byOrder);
  const currentIndex = sorted.findIndex((player) => player.id === id);
  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (targetIndex < 0 || targetIndex >= sorted.length) return;

  const current = sorted[currentIndex];
  const target = sorted[targetIndex];
  [current.order, target.order] = [target.order, current.order];
  savePlayers();
  render();
}

playerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const existing = players.find((player) => player.id === playerId.value);
  const nextPlayer = {
    id: existing?.id || makeId(),
    name: playerName.value.trim(),
    tier: playerTier.value,
    region: playerRegion.value.trim(),
    role: playerRole.value.trim(),
    clan: playerClan.value.trim(),
    notes: playerNotes.value.trim(),
    order: existing?.order || players.length + 1
  };

  if (existing) {
    players = players.map((player) => (player.id === existing.id ? nextPlayer : player));
  } else {
    players.push(nextPlayer);
  }

  savePlayers();
  clearForm();
  render();
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
    players = players.filter((item) => item.id !== id);
    savePlayers();
    clearForm();
    render();
  }

  if (action === "up" || action === "down") {
    reorderPlayer(id, action);
  }
});

document.querySelector("#unlockAdmin").addEventListener("click", () => {
  const code = document.querySelector("#adminCode").value;
  if (code !== adminCode) {
    alert("Wrong admin code.");
    return;
  }

  isAdmin = true;
  adminLock.hidden = true;
  adminWorkspace.hidden = false;
  render();
});

document.querySelector("#clearForm").addEventListener("click", clearForm);

document.querySelector("#resetDemo").addEventListener("click", () => {
  if (!confirm("Reset the tier list back to the demo players?")) return;
  players = starterPlayers.map((player, index) => ({ ...player, id: makeId(), order: index + 1 }));
  savePlayers();
  clearForm();
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

clearForm();
render();
