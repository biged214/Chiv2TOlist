let tiers = [
  { id: "creator", label: "Creator", name: "", color: "#2f1f4f" },
  { id: "s", label: "S", name: "", color: "#7f1d1d" },
  { id: "a", label: "A", name: "", color: "#9b5d1f" },
  { id: "b", label: "B", name: "", color: "#50683e" },
  { id: "c", label: "C", name: "", color: "#536673" },
  { id: "watch", label: "D", name: "", color: "#4c3b62" }
];
let players = [];
let regions = [];
const pages = {
  team_objective: {
    path: "/",
    eyebrow: "Chivalry 2 Team Objective Rankings",
    title: "Community Player Tiers for TO Mains.",
    copy: "Track standout players, grouped by tier, and notes on region, role, strengths, and current form."
  },
  ranked_duelist: {
    path: "/ranked-duelists",
    eyebrow: "Chivalry 2 Ranked Duelist Rankings",
    title: "Community Player Tiers for Ranked Duelists.",
    copy: "Track standout duelists, grouped by tier, with region, role, stats links, and current form."
  }
};
const listType = window.location.pathname.startsWith("/ranked-duelists") ? "ranked_duelist" : "team_objective";

const tierBoard = document.querySelector("#tier-list");
const pageEyebrow = document.querySelector("#pageEyebrow");
const pageTitle = document.querySelector("#pageTitle");
const pageCopy = document.querySelector("#pageCopy");
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
const updateRequestModal = document.querySelector("#updateRequestModal");
const updateRequestForm = document.querySelector("#updateRequestForm");
const updateRequestPlayerId = document.querySelector("#updateRequestPlayerId");
const updateRequestName = document.querySelector("#updateRequestName");
const updateRequestPlayfabId = document.querySelector("#updateRequestPlayfabId");
const updateRequestTier = document.querySelector("#updateRequestTier");
const updateRequestRegion = document.querySelector("#updateRequestRegion");
const updateRequestRole = document.querySelector("#updateRequestRole");
const updateRequestClan = document.querySelector("#updateRequestClan");
const updateRequestNotes = document.querySelector("#updateRequestNotes");
const updateRequestStatus = document.querySelector("#updateRequestStatus");

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
    return await api(`/api/players?listType=${encodeURIComponent(listType)}`);
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

function publicSubmissionTiers() {
  return tiers.filter((tier) => tier.id !== "creator");
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
  const selectedSubmissionRegion = submissionRegion.value;
  const selectedUpdateTier = updateRequestTier.value;
  const selectedUpdateRegion = updateRequestRegion.value;
  const allowedSubmissionTiers = publicSubmissionTiers();

  tierFilter.innerHTML = `<option value="all">All tiers</option>`;
  submissionTier.innerHTML = "";
  updateRequestTier.innerHTML = "";
  tiers.forEach((tier) => {
    const label = tier.name ? `${tier.label} - ${tier.name}` : tier.label;
    tierFilter.append(new Option(label, tier.id));
  });
  allowedSubmissionTiers.forEach((tier) => {
    const label = tier.name ? `${tier.label} - ${tier.name}` : tier.label;
    submissionTier.append(new Option(label, tier.id));
    updateRequestTier.append(new Option(label, tier.id));
  });
  tierFilter.value = tiers.some((tier) => tier.id === selectedTier) ? selectedTier : "all";
  submissionTier.value = allowedSubmissionTiers.some((tier) => tier.id === selectedSubmissionTier) ? selectedSubmissionTier : allowedSubmissionTiers[1]?.id || "b";
  updateRequestTier.value = allowedSubmissionTiers.some((tier) => tier.id === selectedUpdateTier) ? selectedUpdateTier : allowedSubmissionTiers[1]?.id || "b";

  regionFilter.innerHTML = `<option value="all">All regions</option>`;
  regions.forEach((region) => regionFilter.append(new Option(region, region)));
  regionFilter.value = regions.includes(selectedRegion) ? selectedRegion : "all";

  submissionRegion.innerHTML = `<option value="">Select region</option>`;
  updateRequestRegion.innerHTML = `<option value="">Select region</option>`;
  regions.forEach((region) => submissionRegion.append(new Option(region, region)));
  regions.forEach((region) => updateRequestRegion.append(new Option(region, region)));
  submissionRegion.value = regions.includes(selectedSubmissionRegion) ? selectedSubmissionRegion : "";
  updateRequestRegion.value = regions.includes(selectedUpdateRegion) ? selectedUpdateRegion : "";
}

function renderTierBoard() {
  const filtered = visiblePlayers();
  tierBoard.innerHTML = "";

  tiers.forEach((tier) => {
    if (tierFilter.value !== "all" && tierFilter.value !== tier.id) return;

    const row = document.createElement("section");
    row.className = "tier-row";
    row.dataset.tierId = tier.id;
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
  const toggle = card.querySelector(".player-card__toggle");
  const details = card.querySelector(".player-card__details");
  card.querySelector("h3").textContent = player.name;
  card.querySelector(".badge").textContent = tier ? tier.label : player.tier;

  const meta = card.querySelector(".meta-list");
  [
    ["Region", player.region || "Unknown"],
    ["Role", player.role || "Flexible"],
    ["Clan", player.clan || "None"]
  ].forEach(([label, value]) => {
    const item = document.createElement("div");
    item.innerHTML = `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`;
    meta.append(item);
  });

  card.querySelector("p").textContent = player.notes || "No notes yet.";
  const actions = card.querySelector(".player-card__actions");
  const requestButton = document.createElement("button");
  requestButton.className = "text-button";
  requestButton.type = "button";
  requestButton.textContent = "Request update";
  requestButton.addEventListener("click", () => showUpdateRequestModal(player));
  actions.append(requestButton);

  if (player.playfabId) {
    const statsLink = document.createElement("a");
    statsLink.className = "stats-link";
    statsLink.href = `https://chivalry2stats.com/player?id=${encodeURIComponent(player.playfabId)}`;
    statsLink.target = "_blank";
    statsLink.rel = "noopener noreferrer";
    statsLink.textContent = "View Chivalry2Stats record";
    details.append(statsLink);
  }

  toggle.addEventListener("click", () => {
    const isExpanded = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!isExpanded));
    details.hidden = isExpanded;
  });

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

function showUpdateRequestModal(player) {
  const allowedSubmissionTiers = publicSubmissionTiers();
  updateRequestPlayerId.value = player.id;
  updateRequestName.value = player.name || "";
  updateRequestPlayfabId.value = player.playfabId || "";
  updateRequestTier.value = allowedSubmissionTiers.some((tier) => tier.id === player.tier) ? player.tier : allowedSubmissionTiers[1]?.id || "b";
  updateRequestRegion.value = regions.includes(player.region) ? player.region : "";
  updateRequestRole.value = player.role || "";
  updateRequestClan.value = player.clan || "";
  updateRequestNotes.value = player.notes || "";
  updateRequestStatus.textContent = "";
  updateRequestModal.hidden = false;
  document.body.classList.add("modal-open");
  updateRequestName.focus();
}

function hideUpdateRequestModal() {
  updateRequestModal.hidden = true;
  document.body.classList.remove("modal-open");
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

updateRequestModal.addEventListener("click", (event) => {
  if (event.target.closest("[data-close-update-request]")) {
    hideUpdateRequestModal();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !submissionModal.hidden) {
    hideSubmissionModal();
  }
  if (event.key === "Escape" && !updateRequestModal.hidden) {
    hideUpdateRequestModal();
  }
});

submissionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  submissionStatus.textContent = "Sending submission...";

  try {
    await api("/api/submissions", {
      method: "POST",
      body: JSON.stringify({
        listType,
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
    submissionTier.value = publicSubmissionTiers()[1]?.id || "b";
    submissionStatus.textContent = "Submission received. It will stay private until approved.";
  } catch (error) {
    submissionStatus.textContent = error.message;
  }
});

updateRequestForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  updateRequestStatus.textContent = "Sending update request...";

  try {
    const playfabValue = updateRequestPlayfabId.value.trim();
    await api("/api/update-requests", {
      method: "POST",
      body: JSON.stringify({
        listType,
        targetPlayerId: updateRequestPlayerId.value,
        target_player_id: updateRequestPlayerId.value,
        name: updateRequestName.value.trim(),
        playfabId: playfabValue,
        playfab_id: playfabValue,
        tier: updateRequestTier.value,
        region: updateRequestRegion.value.trim(),
        role: updateRequestRole.value.trim(),
        clan: updateRequestClan.value.trim(),
        notes: updateRequestNotes.value.trim()
      })
    });

    updateRequestStatus.textContent = "Update request received. It will stay private until approved.";
  } catch (error) {
    updateRequestStatus.textContent = error.message;
  }
});

async function init() {
  const page = pages[listType];
  pageEyebrow.textContent = page.eyebrow;
  pageTitle.textContent = page.title;
  pageCopy.textContent = page.copy;
  const config = await api("/api/config");
  tiers = config.tiers || tiers;
  regions = await api("/api/regions");
  players = await loadPlayers();
  render();
}

init().catch((error) => {
  tierBoard.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
});
