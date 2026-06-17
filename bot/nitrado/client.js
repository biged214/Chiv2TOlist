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
      ["ServerPassword", "server_password", "password", "join_password", "Password", "server-password"],
      password,
      "set password"
    );
  }

  async removeGameserverPassword() {
    return this.updateFirstSetting(
      ["ServerPassword", "server_password", "password", "join_password", "Password", "server-password"],
      "",
      "remove password"
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

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
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

  async updateFirstSetting(keys, value, actionLabel) {
    const errors = [];
    const discoveredSettings = await this.safeGetSettings();
    const discoveredKeys = settingCandidates(discoveredSettings, keys);
    const keysToTry = [...uniqueSettingTargets(discoveredKeys, keys)];

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
    const categories = [
      typeof target === "object" ? categoryFromPath(target.path) : "",
      "config",
      "settings",
      "general",
      ""
    ].filter((category, index, values) => values.indexOf(category) === index);

    const payloads = [
      { option: key, value },
      { key, value },
      { [key]: value }
    ];

    const methods = ["POST", "PUT", "PATCH"];
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
          try {
            const data = await this.request(`/services/${this.serviceId}/gameservers/settings`, {
              method,
              body: JSON.stringify(body)
            });

            return {
              action: actionLabel,
              ok: true,
              message: data?.message || `Nitrado accepted ${actionLabel}. Restart the server if the change does not apply immediately.`
            };
          } catch (error) {
            errors.push(`${method} ${JSON.stringify(body)} -> ${error.message || "Unknown error"}`);
            if (!isRetryableSettingError(error)) throw error;
          }

          try {
            const data = await this.request(`/services/${this.serviceId}/gameservers/settings`, {
              method,
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams(flattenPayload(body)).toString()
            });

            return {
              action: actionLabel,
              ok: true,
              message: data?.message || `Nitrado accepted ${actionLabel}. Restart the server if the change does not apply immediately.`
            };
          } catch (error) {
            errors.push(`${method} form ${JSON.stringify(body)} -> ${error.message || "Unknown error"}`);
            if (!isRetryableSettingError(error)) throw error;
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
  const looseNeedles = ["server", "name", "password", "players", "slots"];

  return settings
    .filter((setting) => {
      const haystack = normalizeKey(`${setting.key} ${setting.label} ${setting.path}`);
      return needles.some((needle) => haystack.includes(needle) || needle.includes(haystack)) ||
        looseNeedles.some((needle) => haystack.includes(needle));
    })
    .map((setting) => ({
      key: setting.key,
      path: setting.path
    }));
}

function normalizeKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function uniqueSettingTargets(discoveredTargets, fallbackKeys) {
  const targets = [];
  const seen = new Set();

  for (const target of discoveredTargets) {
    const key = target.key || "";
    if (!key || seen.has(key)) continue;
    seen.add(key);
    targets.push(target);
  }

  for (const key of fallbackKeys) {
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ key, path: "" });
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

function normalizeService(service) {
  return {
    id: service?.id || service?.service_id || service?.serviceId || "",
    type: service?.type || service?.category || "",
    status: service?.status || "",
    details: service?.details || {},
    raw: service
  };
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
    message.includes("invalid") ||
    message.includes("unknown")
  );
}
