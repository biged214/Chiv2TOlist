let tiers = [];
let players = [];

const tierBoard = document.querySelector("#tier-list");
const tierFilter = document.querySelector("#tierFilter");
const regionFilter = document.querySelector("#regionFilter");
const searchInput = document.querySelector("#searchInput");

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function api(path) {
  const response = await fetch(path, { credentials: "same-origin" });
  if (!response.ok) throw new Error("Could not load tier list.");
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
  tiers.forEach((tier) => {
    const label = tier.name ? `${tier.label} - ${tier.name}` : tier.label;
    tierFilter.append(new Option(label, tier.id));
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

function render() {
  populateControls();
  renderTierBoard();
}

[tierFilter, regionFilter, searchInput].forEach((control) => {
  control.addEventListener("input", renderTierBoard);
});

async function init() {
  const [config, nextPlayers] = await Promise.all([api("/api/config"), api("/api/players")]);
  tiers = config.tiers;
  players = nextPlayers;
  render();
}

init().catch((error) => {
  tierBoard.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
});
