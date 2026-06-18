const defaultBaseUrl = "https://api.nitrado.net";

export class NitradoError extends Error {
  constructor(message, { statusCode, details } = {}) {
    super(message);
    this.name = "NitradoError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class NitradoClient {
  constructor({ token, serviceId, baseUrl = defaultBaseUrl }) {
    this.token = token;
    this.serviceId = serviceId;
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async getGameserver() {
    const data = await this.request(`/services/${this.serviceId}/gameservers`);
    return normalizeGameserver(data);
  }

  async getGameserverSettings() {
    const data = await this.request(`/services/${this.serviceId}/gameservers/settings`);
    return normalizeSettings(data);
  }

  async listServices() {
    const data = await this.request("/services", { requireServiceId: false });
    const services = Array.isArray(data?.services) ? data.services : Array.isArray(data) ? data : [];
    return services.map(normalizeService);
  }

  async startGameserver() {
    try {
      return await this.gameserverAction("start");
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }

    try {
      const data = await this.request(`/services/${this.serviceId}/start`, {
        method: "POST"
      });

      return {
        action: "start",
        ok: true,
        message: data?.message || "Nitrado accepted the service start request."
      };
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }

    const data = await this.request(`/services/${this.serviceId}/gameservers/restart`, {
      method: "POST"
    });

    return {
      action: "start",
      ok: true,
      message: data?.message || "Nitrado accepted a restart request to bring the stopped server online."
    };
  }

  async stopGameserver() {
    return this.gameserverAction("stop");
  }

  async restartGameserver() {
    return this.gameserverAction("restart");
  }

  async renameGameserver(name) {
    return this.updateFirstSetting(
      ["ServerName", "server_name", "hostname", "name", "serverName", "server-name"],
      name,
      "rename"
    );
  }

  async setGameserverPassword(password) {
    return this.updateFirstSetting(
      ["ServerPassword"],
      password,
      "set password",
      (key) => normalizeKey(key) === "serverpassword",
      ["category:config"]
    );
  }

  async removeGameserverPassword() {
    return this.updateFirstSetting(
      ["ServerPassword"],
      "",
      "remove password",
      (key) => normalizeKey(key) === "serverpassword",
      ["category:config"]
    );
  }

  async setGameserverMaxPlayers(maxPlayers) {
    return this.updateFirstSetting(
      ["MaxPlayers", "maxplayers", "max_players", "slots", "player_slots", "max-players"],
      String(maxPlayers),
      "set max players"
    );
  }

  async gameserverAction(action) {
    const data = await this.request(`/services/${this.serviceId}/gameservers/${action}`, {
      method: "POST"
    });

    return {
      action,
      ok: true,
      message: data?.message || `Nitrado accepted the ${action} request.`
    };
  }

  async request(path, options = {}) {
    if (!this.token) {
      throw new NitradoError("Missing NITRADO_TOKEN.");
    }

    if (options.requireServiceId !== false && !this.serviceId) {
      throw new NitradoError("Missing NITRADO_SERVICE_ID.");
    }

    const headers = {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/json",
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(options.headers || {})
    };

    for (const key of Object.keys(headers)) {
      if (headers[key] === undefined) delete headers[key];
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers
    });

    const text = await response.text();
    const data = parseJson(text);

    if (!response.ok || data?.status === "error") {
      throw new NitradoError(nitradoErrorMessage(data, response.status), {
        statusCode: response.status,
        details: data
      });
    }

    return data?.data ?? data;
  }

  async updateFirstSetting(keys, value, actionLabel, isAllowedKey = () => true, relatedCategoryKeys = []) {
    const errors = [];
    const discoveredSettings = await this.safeGetSettings();
    const discoveredKeys = settingCandidates(discoveredSettings, keys);
    const relatedCategories = settingCandidates(discoveredSettings, relatedCategoryKeys)
      .map((target) => categoryFromPath(target.path))
      .filter(Boolean);
    const explicitCategories = relatedCategoryKeys
      .filter((key) => String(key).startsWith("category:"))
      .map((key) => String(key).slice("category:".length))
      .filter(Boolean);
    const keysToTry = [...uniqueSettingTargets(discoveredKeys, keys, relatedCategories)].filter((target) =>
      isAllowedKey(target.key)
    );
    for (const category of explicitCategories) {
      for (const key of keys) {
        if (isAllowedKey(key) && !keysToTry.some((target) => target.key === key && target.path === category)) {
          keysToTry.unshift({ key, path: category });
        }
      }
    }

    for (const target of keysToTry) {
      try {
        return await this.updateGameserverSetting(target, value, actionLabel);
      } catch (error) {
        errors.push(`${target.key}: ${error.message || "Unknown error"}`);
        if (!isRetryableSettingError(error)) throw error;
      }
    }

    throw new NitradoError(`Nitrado did not accept any ${actionLabel} setting key. Tried: ${errors.join("; ")}`);
  }

  async safeGetSettings() {
    try {
      return await this.getGameserverSettings();
    } catch {
      return [];
    }
  }

  async updateGameserverSetting(target, value, actionLabel) {
    const key = typeof target === "string" ? target : target.key;
    const discoveredCategory = typeof target === "object" ? categoryFromPath(target.path) : "";
    const categories = [
      discoveredCategory,
      "config",
      "settings",
      "general",
      ""
    ].filter((category, index, values) => category && values.indexOf(category) === index);
    categories.push("");

    const payloads = [
      { option: key, value },
      { key, value },
      { [key]: value }
    ];

    const methods = ["PUT", "POST", "PATCH"];
    const errors = [];

    for (const method of methods) {
      for (const category of categories) {
        const categorizedPayloads = category
          ? [
              { category, key, value, option: key },
              { category, key, value },
              ...payloads
            ]
          : payloads;

        for (const body of categorizedPayloads) {
          for (const attempt of settingUpdateAttempts({ serviceId: this.serviceId, category, key, value, body })) {
            try {
              const data = await this.request(attempt.path, {
                method,
                headers: attempt.headers,
                body: attempt.body
              });

              return {
                action: actionLabel,
                ok: true,
                message:
                  data?.message ||
                  `Nitrado accepted ${actionLabel} for ${key}${category ? ` in ${category}` : ""} via ${method} ${attempt.label}. Restart the server if the change does not apply immediately.`
              };
            } catch (error) {
              errors.push(`${method} ${attempt.label} -> ${error.message || "Unknown error"}`);
              if (!isRetryableSettingError(error)) throw error;
            }
          }
        }
      }
    }

    throw new NitradoError(`Nitrado rejected ${actionLabel}. Tried setting key "${key}". Last errors: ${errors.slice(-3).join("; ")}`);
  }
}

function parseJson(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function nitradoErrorMessage(data, statusCode) {
  return data?.message || data?.error || `Nitrado request failed with HTTP ${statusCode}.`;
}

function normalizeGameserver(data) {
  const server = data?.gameserver || data;
  const query = server?.query || {};
  const settings = server?.settings || {};
  const service = data?.service || {};

  return {
    name: server?.name || settings?.config?.hostname || service?.details?.address || "Chivalry 2 server",
    status: server?.status || server?.status_text || service?.status || "unknown",
    game: server?.game || server?.game_human || server?.game_specific?.game || "Chivalry 2",
    players: firstNumber(query?.player_current, query?.players, server?.players),
    maxPlayers: firstNumber(query?.player_max, query?.maxplayers, server?.slots),
    map: query?.map || server?.map || "",
    address: query?.address || server?.ip || service?.details?.address || "",
    raw: server
  };
}

function normalizeSettings(data) {
  const root = data?.settings || data?.gameserver?.settings || data;
  const results = [];

  collectSettings(root, [], results);
  return results;
}

function collectSettings(value, pathParts, results) {
  if (!value || typeof value !== "object") return;

  if (Array.isArray(value)) {
    for (const item of value) {
      collectSettings(item, pathParts, results);
    }
    return;
  }

  const key = value.key || value.name || value.id || value.option || value.variable;
  if (key) {
    results.push({
      key: String(key),
      label: String(value.label || value.title || value.description || ""),
      value: settingValue(value),
      path: pathParts.join(".")
    });
  }

  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (entryValue && typeof entryValue === "object") {
      collectSettings(entryValue, [...pathParts, entryKey], results);
      continue;
    }

    if (["string", "number", "boolean"].includes(typeof entryValue)) {
      results.push({
        key: entryKey,
        label: "",
        value: entryValue,
        path: pathParts.join(".")
      });
    }
  }
}

function settingValue(value) {
  if ("value" in value) return value.value;
  if ("current" in value) return value.current;
  if ("default" in value) return value.default;
  return "";
}

function settingCandidates(settings, preferredKeys) {
  const needles = preferredKeys.map(normalizeKey);

  return settings
    .filter((setting) => {
      const haystack = normalizeKey(`${setting.key} ${setting.label} ${setting.path}`);
      return needles.some((needle) => haystack.includes(needle) || needle.includes(haystack));
    })
    .map((setting) => ({
      key: setting.key,
      path: setting.path
    }));
}

function normalizeKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function uniqueSettingTargets(discoveredTargets, fallbackKeys, relatedCategories = []) {
  const targets = [];
  const seen = new Set();

  for (const target of discoveredTargets) {
    const key = target.key || "";
    if (!key || seen.has(key)) continue;
    seen.add(key);
    targets.push(target);
  }

  for (const key of fallbackKeys) {
    for (const category of relatedCategories) {
      const id = `${key}:${category}`;
      if (seen.has(id)) continue;
      seen.add(id);
      targets.push({ key, path: category });
    }

    if (!seen.has(key)) {
      seen.add(key);
      targets.push({ key, path: "" });
    }
  }

  return targets;
}

function categoryFromPath(path) {
  return String(path || "").split(".").find(Boolean) || "";
}

function flattenPayload(payload) {
  return Object.fromEntries(
    Object.entries(payload).map(([key, value]) => [key, String(value ?? "")])
  );
}

function settingUpdateAttempts({ serviceId, category, key, value, body }) {
  const attempts = [];
  const encodedCategory = encodeURIComponent(category);
  const encodedKey = encodeURIComponent(key);
  const isPasswordSetting = normalizeKey(key) === "serverpassword";

  if (category) {
    attempts.push({
      label: `category path nested settings ${category}/${key}`,
      path: `/services/${serviceId}/gameservers/settings/${encodedCategory}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ [`settings[${key}]`]: String(value ?? "") }).toString()
    });
    attempts.push({
      label: `category path json settings ${category}/${key}`,
      path: `/services/${serviceId}/gameservers/settings/${encodedCategory}`,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: { [key]: value } })
    });
    attempts.push({
      label: `category path key/value ${category}/${key}`,
      path: `/services/${serviceId}/gameservers/settings/${encodedCategory}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ key, value: String(value ?? "") }).toString()
    });
    attempts.push({
      label: `multipart category path key/value ${category}/${key}`,
      path: `/services/${serviceId}/gameservers/settings/${encodedCategory}`,
      headers: {},
      body: formData({ key, value: String(value ?? "") })
    });
    attempts.push({
      label: `category path direct ${category}/${key}`,
      path: `/services/${serviceId}/gameservers/settings/${encodedCategory}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ [key]: String(value ?? "") }).toString()
    });
    attempts.push({
      label: `path ${category}/${key}`,
      path: `/services/${serviceId}/gameservers/settings/${encodedCategory}/${encodedKey}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ value: String(value ?? "") }).toString()
    });
    if (!isPasswordSetting) {
      attempts.push({
        label: `form category/key/value ${category}/${key}`,
        path: `/services/${serviceId}/gameservers/settings`,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ category, key, value: String(value ?? "") }).toString()
      });
    }
    attempts.push({
      label: `multipart category/key/value ${category}/${key}`,
      path: `/services/${serviceId}/gameservers/settings`,
      headers: {},
      body: formData({ category, key, value: String(value ?? "") })
    });
    attempts.push({
      label: `form category nested settings ${category}/${key}`,
      path: `/services/${serviceId}/gameservers/settings`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ category, [`settings[${key}]`]: String(value ?? "") }).toString()
    });
    attempts.push({
      label: `json category settings ${category}/${key}`,
      path: `/services/${serviceId}/gameservers/settings`,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category, settings: { [key]: value } })
    });
    attempts.push({
      label: `query category direct ${category}/${key}`,
      path: `/services/${serviceId}/gameservers/settings?category=${encodedCategory}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ [key]: String(value ?? "") }).toString()
    });
  }

  if (!isPasswordSetting) {
    attempts.push({
      label: `form ${JSON.stringify(body)}`,
      path: `/services/${serviceId}/gameservers/settings`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(flattenPayload(body)).toString()
    });

    attempts.push({
      label: `json ${JSON.stringify(body)}`,
      path: `/services/${serviceId}/gameservers/settings`,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  }

  return attempts;
}

function normalizeService(service) {
  return {
    id: service?.id || service?.service_id || service?.serviceId || "",
    type: service?.type || service?.category || "",
    status: service?.status || "",
    details: service?.details || {},
    raw: service
  };
}

function formData(fields) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    data.append(key, value);
  }
  return data;
}

function firstNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return undefined;
}

function isNotFound(error) {
  return error?.statusCode === 404 || String(error?.message || "").toLowerCase() === "not found";
}

function isRetryableSettingError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    error?.statusCode === 400 ||
    error?.statusCode === 404 ||
    error?.statusCode === 405 ||
    error?.statusCode === 422 ||
    message.includes("not found") ||
    message.includes("no category given") ||
    message.includes("no key given") ||
    message.includes("invalid") ||
    message.includes("unknown")
  );
}
