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
    return this.gameserverAction("start");
  }

  async stopGameserver() {
    return this.gameserverAction("stop");
  }

  async restartGameserver() {
    return this.gameserverAction("restart");
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
