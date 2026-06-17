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
    return this.updateFirstSetting(["hostname", "server_name", "name"], name, "rename");
  }

  async setGameserverPassword(password) {
    return this.updateFirstSetting(["password", "server_password", "join_password"], password, "set password");
  }

  async removeGameserverPassword() {
    return this.updateFirstSetting(["password", "server_password", "join_password"], "", "remove password");
  }

  async setGameserverMaxPlayers(maxPlayers) {
    return this.updateFirstSetting(["maxplayers", "max_players", "slots", "player_slots"], String(maxPlayers), "set max players");
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

    for (const key of keys) {
      try {
        return await this.updateGameserverSetting(key, value, actionLabel);
      } catch (error) {
        errors.push(`${key}: ${error.message || "Unknown error"}`);
        if (!isRetryableSettingError(error)) throw error;
      }
    }

    throw new NitradoError(`Nitrado did not accept any ${actionLabel} setting key. Tried: ${errors.join("; ")}`);
  }

  async updateGameserverSetting(key, value, actionLabel) {
    const payloads = [
      { category: "config", key, value },
      { category: "settings", key, value },
      { key, value },
      { [key]: value }
    ];

    const methods = ["POST", "PUT", "PATCH"];
    const errors = [];

    for (const method of methods) {
      for (const body of payloads) {
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
