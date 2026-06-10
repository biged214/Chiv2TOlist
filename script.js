let tiers = [
  { id: "s", label: "S", name: "", color: "#7f1d1d" },
  { id: "a", label: "A", name: "", color: "#9b5d1f" },
  { id: "b", label: "B", name: "", color: "#50683e" },
  { id: "c", label: "C", name: "", color: "#536673" },
  { id: "watch", label: "D", name: "", color: "#4c3b62" }
];
let players = [];

const tierBoard = document.querySelector("#tier-list");
const tierFilter = document.querySelector("#tierFilter");
const regionFilter = document.querySelector("#regionFilter");
const searchInput = document.querySelector("#searchInput");
const openSubmissionModal = document.querySelector("#openSubmissionModal");
const submissionModal = document.querySelector("#submissionModal");
const submissionForm = document.querySelector("#submissionForm");
const submissionName = document.querySelector("#submissionName");
const submissionPlayfabId = document.querySelector("#submissionPlayfabId");
const submissionTier = document.querySelector("#submissionTier");
const submissionRegion = document.querySelector("#submissionRegion");
const submissionRole = document.querySelector("#submissionRole");
const submissionClan = document.querySelector("#submissionClan");
const submissionNotes = document.querySelector("#submissionNotes");
const submissionStatus = document.querySelector("#submissionStatus");

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
    const error = await response.json().catch(() => ({ error: "Could not load tier list." }));
    throw new Error(error.error || "Could not load tier list.");
  }
  return response.json();
}

async function loadPlayers() {
  try {
    return await api("/api/players");
  } catch {
    return api("/data/players.json");
  }
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
    const searchable = [player.name, player.region, player.role, player.clan, player.playfabId, player.notes]
      .join(" ")
      .toLowerCase();
    const matchesTier = filters.tier === "all" || player.tier === filters.tier;
    const matchesRegion = filters.region === "all" || player.region === filters.region;
    const matchesSearch = !filters.search || searchable.includes(filters.search);
    return matchesTier && matchesRegion && matchesSearch;
  });
}

function populateControls() {
  const selectedTier = tierFilter.value;
  const selectedRegion = regionFilter.value;
  const selectedSubmissionTier = submissionTier.value;

  tierFilter.innerHTML = `<option value="all">All tiers</option>`;
  submissionTier.innerHTML = "";
  tiers.forEach((tier) => {
    const label = tier.name ? `${tier.label} - ${tier.name}` : tier.label;
    tierFilter.append(new Option(label, tier.id));
    submissionTier.append(new Option(label, tier.id));
  });
  tierFilter.value = tiers.some((tier) => tier.id === selectedTier) ? selectedTier : "all";
  submissionTier.value = tiers.some((tier) => tier.id === selectedSubmissionTier) ? selectedSubmissionTier : tiers[2]?.id || "b";

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

  if (player.playfabId) {
    const statsLink = document.createElement("a");
    statsLink.className = "stats-link";
    statsLink.href = `https://chivalry2stats.com/player?id=${encodeURIComponent(player.playfabId)}`;
    statsLink.target = "_blank";
    statsLink.rel = "noopener noreferrer";
    statsLink.textContent = "View Chivalry2Stats record";
    card.append(statsLink);
  }

  return card;
}

function render() {
  populateControls();
  renderTierBoard();
}

function showSubmissionModal() {
  submissionModal.hidden = false;
  document.body.classList.add("modal-open");
  submissionName.focus();
}

function hideSubmissionModal() {
  submissionModal.hidden = true;
  document.body.classList.remove("modal-open");
  openSubmissionModal.focus();
}

[tierFilter, regionFilter, searchInput].forEach((control) => {
  control.addEventListener("input", renderTierBoard);
});

openSubmissionModal.addEventListener("click", showSubmissionModal);

submissionModal.addEventListener("click", (event) => {
  if (event.target.closest("[data-close-submission]")) {
    hideSubmissionModal();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !submissionModal.hidden) {
    hideSubmissionModal();
  }
});

submissionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  submissionStatus.textContent = "Sending submission...";

  try {
    await api("/api/submissions", {
      method: "POST",
      body: JSON.stringify({
        name: submissionName.value.trim(),
        playfabId: submissionPlayfabId.value.trim(),
        playfab_id: submissionPlayfabId.value.trim(),
        tier: submissionTier.value,
        region: submissionRegion.value.trim(),
        role: submissionRole.value.trim(),
        clan: submissionClan.value.trim(),
        notes: submissionNotes.value.trim()
      })
    });

    submissionForm.reset();
    submissionTier.value = tiers[2]?.id || "b";
    submissionStatus.textContent = "Submission received. It will stay private until approved.";
  } catch (error) {
    submissionStatus.textContent = error.message;
  }
});

async function init() {
  players = await loadPlayers();
  render();
}

init().catch((error) => {
  tierBoard.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
});
