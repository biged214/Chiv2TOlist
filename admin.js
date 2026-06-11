let tiers = [
  { id: "creator", label: "Creator", name: "", color: "#2f1f4f" },
  { id: "s", label: "S", name: "", color: "#7f1d1d" },
  { id: "a", label: "A", name: "", color: "#9b5d1f" },
  { id: "b", label: "B", name: "", color: "#50683e" },
  { id: "c", label: "C", name: "", color: "#536673" },
  { id: "watch", label: "D", name: "", color: "#4c3b62" }
];
let listTypes = [
  { id: "team_objective", label: "Team Objective", path: "/" },
  { id: "ranked_duelist", label: "Ranked Duelists", path: "/ranked-duelists" }
];
let players = [];
let submissions = [];
let regions = [];
let currentListType = "team_objective";
let isAdmin = false;

const playerForm = document.querySelector("#playerForm");
const adminListType = document.querySelector("#adminListType");
const playerId = document.querySelector("#playerId");
const playerName = document.querySelector("#playerName");
const playerTier = document.querySelector("#playerTier");
const playerRegion = document.querySelector("#playerRegion");
const playerRole = document.querySelector("#playerRole");
const playerClan = document.querySelector("#playerClan");
const playerPlayfabId = document.querySelector("#playerPlayfabId");
const playerDiscordUsername = document.querySelector("#playerDiscordUsername");
const playerNotes = document.querySelector("#playerNotes");
const adminList = document.querySelector("#adminList");
const submissionList = document.querySelector("#submissionList");
const regionForm = document.querySelector("#regionForm");
const newRegion = document.querySelector("#newRegion");
const regionList = document.querySelector("#regionList");
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

function populateListTypeSelect() {
  const selected = adminListType.value || currentListType;
  adminListType.innerHTML = "";
  listTypes.forEach((listType) => adminListType.append(new Option(listType.label, listType.id)));
  adminListType.value = listTypes.some((item) => item.id === selected) ? selected : "team_objective";
  currentListType = adminListType.value;
}

function populateRegionSelect() {
  const selectedRegion = playerRegion.value;
  playerRegion.innerHTML = `<option value="">Select region</option>`;
  regions.forEach((region) => playerRegion.append(new Option(region, region)));
  playerRegion.value = regions.includes(selectedRegion) ? selectedRegion : "";
}

function renderRegions() {
  regionList.innerHTML = "";
  regions.forEach((region) => {
    const item = document.createElement("span");
    item.className = "region-chip";
    item.innerHTML = `
      ${escapeHtml(region)}
      <button type="button" data-region="${escapeHtml(region)}" aria-label="Remove ${escapeHtml(region)}">&times;</button>
    `;
    regionList.append(item);
  });
}

async function refreshRegions() {
  regions = await api("/api/regions");
  populateRegionSelect();
  renderRegions();
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
        <span>Discord: ${escapeHtml(player.discordUsername || "Not provided")}</span>
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

function renderSubmissions() {
  submissionList.innerHTML = "";

  if (!submissions.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No pending submissions right now.";
    submissionList.append(empty);
    return;
  }

  submissions.forEach((submission) => {
    const tier = tiers.find((item) => item.id === submission.tier);
    const isUpdateRequest = submission.requestType === "update";
    const item = document.createElement("article");
    item.className = "submission-item";
    item.innerHTML = `
      <div>
        <strong>${escapeHtml(submission.name)}</strong>
        <span>${isUpdateRequest ? "Update request" : "New submission"} - ${escapeHtml(tier?.label || submission.tier)} tier - ${escapeHtml(submission.region || "Unknown region")} - ${escapeHtml(submission.role || "Flexible")}${submission.playfabId ? " - PlayFab included" : ""}</span>
        <span>Discord: ${escapeHtml(submission.discordUsername || "Not provided")}</span>
        ${
          submission.playfabId
            ? `<a class="stats-link" href="https://chivalry2stats.com/player?id=${encodeURIComponent(submission.playfabId)}" target="_blank" rel="noopener noreferrer">Review Chivalry2Stats record</a>`
            : ""
        }
        <p>${escapeHtml(submission.notes || "No notes included.")}</p>
      </div>
      <div class="admin-actions">
        <button class="mini-button mini-button--approve" type="button" data-submission-action="approve" data-id="${submission.id}">Approve</button>
        <button class="mini-button" type="button" data-submission-action="reject" data-id="${submission.id}">Reject</button>
      </div>
    `;
    submissionList.append(item);
  });
}

function clearForm() {
  playerForm.reset();
  playerId.value = "";
  playerTier.value = tiers[2]?.id || tiers[0]?.id || "b";
}

async function refreshPlayers() {
  players = await api(`/api/players?listType=${encodeURIComponent(currentListType)}`);
  renderAdminList();
}

async function refreshSubmissions() {
  submissions = await api(`/api/submissions?listType=${encodeURIComponent(currentListType)}`);
  renderSubmissions();
}

async function savePlayer(event) {
  event.preventDefault();
  const playfabValue = playerPlayfabId.value.trim();
  const body = {
    listType: currentListType,
    name: playerName.value.trim(),
    tier: playerTier.value,
    region: playerRegion.value.trim(),
    role: playerRole.value.trim(),
    clan: playerClan.value.trim(),
    playfabId: playfabValue,
    playfab_id: playfabValue,
    playerfabId: playfabValue,
    playerfab_id: playfabValue,
    discordUsername: playerDiscordUsername.value.trim(),
    discord_username: playerDiscordUsername.value.trim(),
    notes: playerNotes.value.trim()
  };

  let savedPlayer;
  if (playerId.value) {
    savedPlayer = await api(`/api/players/${encodeURIComponent(playerId.value)}?listType=${encodeURIComponent(currentListType)}`, {
      method: "PUT",
      body: JSON.stringify(body)
    });
  } else {
    savedPlayer = await api("/api/players", {
      method: "POST",
      body: JSON.stringify(body)
    });
  }

  if (playfabValue && savedPlayer.playfabId !== playfabValue) {
    throw new Error("PlayFab ID did not save. Please refresh the admin page and try again.");
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
    playerDiscordUsername.value = player.discordUsername || "";
    playerNotes.value = player.notes;
    playerName.focus();
  }

  if (action === "delete" && player && confirm(`Delete ${player.name}?`)) {
    api(`/api/players/${encodeURIComponent(id)}?listType=${encodeURIComponent(currentListType)}`, { method: "DELETE" })
      .then(refreshPlayers)
      .catch((error) => alert(error.message));
  }

  if (action === "up" || action === "down") {
    api("/api/players/reorder", {
      method: "POST",
      body: JSON.stringify({ id, direction: action, listType: currentListType })
    })
      .then((nextPlayers) => {
        players = nextPlayers;
        renderAdminList();
      })
      .catch((error) => alert(error.message));
  }
});

submissionList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-submission-action]");
  if (!button) return;

  const { submissionAction, id } = button.dataset;
  const submission = submissions.find((item) => item.id === id);
  if (!submission) return;

  if (submissionAction === "approve") {
    api(`/api/submissions/${encodeURIComponent(id)}/approve?listType=${encodeURIComponent(currentListType)}`, { method: "POST" })
      .then(async () => {
        await refreshPlayers();
        await refreshSubmissions();
      })
      .catch((error) => alert(error.message));
  }

  if (submissionAction === "reject" && confirm(`Reject ${submission.name}?`)) {
    api(`/api/submissions/${encodeURIComponent(id)}/reject?listType=${encodeURIComponent(currentListType)}`, { method: "POST" })
      .then(refreshSubmissions)
      .catch((error) => alert(error.message));
  }
});

adminListType.addEventListener("change", async () => {
  currentListType = adminListType.value;
  clearForm();
  await refreshPlayers();
  await refreshSubmissions();
});

regionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = newRegion.value.trim();
  if (!name) return;
  regions = await api("/api/regions", {
    method: "POST",
    body: JSON.stringify({ name })
  });
  newRegion.value = "";
  populateRegionSelect();
  renderRegions();
});

regionList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-region]");
  if (!button) return;
  regions = await api(`/api/regions/${encodeURIComponent(button.dataset.region)}`, { method: "DELETE" });
  populateRegionSelect();
  renderRegions();
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
    await refreshRegions();
    await refreshPlayers();
    await refreshSubmissions();
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
  players = await api("/api/players/reset", {
    method: "POST",
    body: JSON.stringify({ listType: currentListType })
  });
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
  const config = await api("/api/config");
  tiers = config.tiers || tiers;
  listTypes = config.listTypes || listTypes;
  populateListTypeSelect();
  await refreshRegions();
  isAdmin = false;
  submissions = [];
  players = await api(`/api/players?listType=${encodeURIComponent(currentListType)}`);
  populateTierSelect();
  populateRegionSelect();
  renderSubmissions();
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
