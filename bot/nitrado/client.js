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

  async getServiceDebug() {
    const [gameserverData, services] = await Promise.all([
      this.request(`/services/${this.serviceId}/gameservers`).catch((error) => ({ error: error.message || "Unknown error" })),
      this.listServices().catch(() => [])
    ]);
    const service = services.find((entry) => String(entry.id) === String(this.serviceId));

    return {
      serviceId: this.serviceId,
      service: sanitizeDebugValue(service?.raw || service || {}),
      gameserver: sanitizeDebugValue(gameserverData)
    };
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
      ["category:config"],
      { verify: true }
    );
  }

  async removeGameserverPassword() {
    return this.updateFirstSetting(
      ["ServerPassword"],
      "",
      "remove password",
      (key) => normalizeKey(key) === "serverpassword",
      ["category:config"],
      { verify: true }
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

  async requestRaw(path, options = {}) {
    if (!this.token) {
      throw new NitradoError("Missing NITRADO_TOKEN.");
    }

    if (options.requireServiceId !== false && !this.serviceId) {
      throw new NitradoError("Missing NITRADO_SERVICE_ID.");
    }

    const headers = {
      Authorization: `Bearer ${this.token}`,
      Accept: options.accept || "*/*",
      ...(options.body instanceof FormData ? {} : options.headers || {}),
      ...(options.body instanceof FormData ? options.headers || {} : {})
    };

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

    return {
      contentType: response.headers.get("content-type") || "",
      text,
      data: data?.data ?? data
    };
  }

  async updateGameConfigFileSetting(key, value, actionLabel) {
    const errors = [];
    const files = await this.findConfigFiles();

    for (const file of files) {
      try {
        const original = await this.downloadFile(file);
        const updated = updateIniValue(original, key, value);
        if (updated === original) {
          return {
            action: actionLabel,
            ok: true,
            message: `${key} was already ${value ? "set to that value" : "empty"} in ${file}.`
          };
        }

        await this.uploadFile(file, updated);
        const verified = await this.downloadFile(file);
        if (readIniValue(verified, key) !== String(value ?? "")) {
          throw new NitradoError(`${key} did not verify after file upload.`);
        }

        return {
          action: actionLabel,
          ok: true,
          message: `Updated ${key} in ${file}. Restart the server for the change to apply.`
        };
      } catch (error) {
        errors.push(`${file}: ${error.message || "Unknown error"}`);
        if (!isRetryableFileError(error)) throw error;
      }
    }

    throw new NitradoError(
      `Could not update ${key} through Nitrado file access. Tried likely config files. Last errors: ${errors.slice(-4).join("; ")}`
    );
  }

  async updateGamePropertyOrConfigFile(key, value, actionLabel) {
    const propertyErrors = [];

    try {
      return await this.updateGameProperty(key, value, actionLabel);
    } catch (error) {
      propertyErrors.push(error.message || "Unknown error");
      if (!isRetryablePropertyError(error)) throw error;
    }

    try {
      return await this.updateGameConfigFileSetting(key, value, actionLabel);
    } catch (error) {
      throw new NitradoError(
        `Could not update ${key} through Nitrado game properties or config files. Properties error: ${propertyErrors.join("; ")}. File error: ${error.message || "Unknown error"}`
      );
    }
  }

  async updateGameProperty(key, value, actionLabel) {
    const errors = [];

    for (const attempt of gamePropertyUpdateAttempts(this.serviceId, key, value)) {
      try {
        const data = await this.request(attempt.path, {
          method: attempt.method || "POST",
          headers: attempt.headers,
          body: attempt.body
        });

        return {
          action: actionLabel,
          ok: true,
          message:
            data?.message ||
            `Nitrado accepted ${actionLabel} for ${key} via games/properties (${attempt.label}). Restart the server for the change to apply.`
        };
      } catch (error) {
        errors.push(`${attempt.label}: ${error.message || "Unknown error"}`);
        if (!isRetryablePropertyError(error)) throw error;
      }
    }

    throw new NitradoError(`Nitrado rejected ${key} via games/properties. Last errors: ${errors.slice(-5).join("; ")}`);
  }

  async listFiles(directory = "/") {
    return this.listFileServerDirectory(normalizeNitradoInputPath(directory));
  }

  async scanFileRoots() {
    const hints = await this.fileRootHints();
    const queue = [
      "/",
      "/games",
      "/gameserver",
      "/ftproot",
      "/chivalry2",
      "/Chivalry2",
      "/Chivalry",
      "/server",
      "/home",
      ...hints
    ];
    const results = [];
    const seen = new Set();

    while (queue.length && results.length < 45) {
      const path = normalizeNitradoInputPath(queue.shift());
      if (!path || seen.has(path)) continue;
      seen.add(path);

      try {
        const result = await this.listFiles(path);
        results.push({
          path: result.path || path,
          count: result.entries.length,
          sample: result.entries.slice(0, 5).map((entry) => entry.path || entry.name).filter(Boolean),
          rawKeys: result.rawKeys || []
        });

        for (const entry of result.entries) {
          if ((entry.type === "dir" || entry.isDirectory) && (entry.path || entry.name)) {
            queue.push(entry.path || `${path.replace(/\/$/, "")}/${entry.name}`);
          }
        }
      } catch (error) {
        results.push({
          path,
          error: error.message || "Unknown error"
        });
      }
    }

    return results;
  }

  async fileRootHints() {
    const debug = await this.getServiceDebug();
    const values = [
      findNestedValue(debug, "gameserver.gameserver.username"),
      findNestedValue(debug, "service.details.folder_short"),
      findNestedValue(debug, "service.details.portlist_short"),
      findNestedValue(debug, "service.details.game"),
      findNestedValue(debug, "gameserver.gameserver.game")
    ]
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    const username = values.find((value) => /^ni\d+_\d+$/i.test(value));
    const folders = values.filter((value) => !/^ni\d+_\d+$/i.test(value)).map((value) => value.replace(/\s+/g, ""));
    const hints = [];

    for (const folder of folders) {
      hints.push(`/${folder}`, `/games/${folder}`, `/server/${folder}`);
    }

    if (username) {
      hints.push(
        `/${username}`,
        `/home/${username}`,
        `/games/${username}`,
        `/games/${username}/ftproot`,
        `/server/${username}`
      );
      for (const folder of folders) {
        hints.push(
          `/${username}/${folder}`,
          `/home/${username}/${folder}`,
          `/games/${username}/${folder}`,
          `/games/${username}/ftproot/${folder}`,
          `/server/${username}/${folder}`
        );
      }
    }

    return hints;
  }

  async findConfigFiles() {
    const roots = await this.fileRootHints().catch(() => []);
    const rootFiles = [];
    for (const root of roots) {
      rootFiles.push(
        `${root}/Chivalry/Saved/Config/LinuxServer/Game.ini`,
        `${root}/Chivalry/Saved/Config/WindowsServer/Game.ini`,
        `${root}/Chivalry/Saved/Config/LinuxServer/Engine.ini`,
        `${root}/Chivalry/Saved/Config/WindowsServer/Engine.ini`
      );
    }

    const likelyFiles = [
      ...rootFiles,
      "/games/chivalry2/Chivalry/Saved/Config/LinuxServer/Game.ini",
      "/games/chivalry2/Chivalry/Saved/Config/WindowsServer/Game.ini",
      "/games/Chivalry2/Chivalry/Saved/Config/LinuxServer/Game.ini",
      "/games/Chivalry2/Chivalry/Saved/Config/WindowsServer/Game.ini",
      "/chivalry2/Chivalry/Saved/Config/LinuxServer/Game.ini",
      "/chivalry2/Chivalry/Saved/Config/WindowsServer/Game.ini",
      "/Chivalry2/Chivalry/Saved/Config/LinuxServer/Game.ini",
      "/Chivalry2/Chivalry/Saved/Config/WindowsServer/Game.ini"
    ];

    const discovered = await this.discoverConfigFiles().catch(() => []);
    return [...new Set([...discovered, ...likelyFiles])];
  }

  async discoverConfigFiles() {
    const queue = ["/", "/games", "/games/chivalry2", "/games/Chivalry2", ...(await this.fileRootHints().catch(() => []))];
    const seen = new Set();
    const files = [];

    while (queue.length && seen.size < 80) {
      const directory = queue.shift();
      if (!directory || seen.has(directory)) continue;
      seen.add(directory);

      let entries;
      try {
        entries = (await this.listFileServerDirectory(directory)).entries;
      } catch {
        continue;
      }

      for (const entry of entries) {
        const path = normalizeFilePath(entry.path || `${directory.replace(/\/$/, "")}/${entry.name || ""}`);
        if (!path || seen.has(path)) continue;

        if (entry.type === "dir" || entry.isDirectory) {
          if (isLikelyConfigDirectory(path)) queue.push(path);
          continue;
        }

        if (isLikelyChivalryConfigFile(path)) files.push(path);
      }
    }

    return files;
  }

  async listFileServerDirectory(directory) {
    directory = normalizeNitradoInputPath(directory);
    const encodedDirectory = fileQueryValue(directory);
    const relativeDirectory = fileQueryValue(trimLeadingSlash(directory));
    const attempts = [
      `/services/${this.serviceId}/gameservers/file_server/list?dir=${encodedDirectory}`,
      `/services/${this.serviceId}/gameservers/file_server/list?path=${encodedDirectory}`,
      `/services/${this.serviceId}/gameservers/file_server/list?directory=${encodedDirectory}`,
      `/services/${this.serviceId}/gameservers/file_server/list?dir=${relativeDirectory}`,
      `/services/${this.serviceId}/gameservers/file_server/list?path=${relativeDirectory}`,
      {
        path: `/services/${this.serviceId}/gameservers/file_server/list`,
        options: {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ dir: directory }).toString()
        }
      },
      {
        path: `/services/${this.serviceId}/gameservers/file_server/list`,
        options: {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ dir: trimLeadingSlash(directory) }).toString()
        }
      },
      {
        path: `/services/${this.serviceId}/gameservers/file_server/list`,
        options: {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ path: directory }).toString()
        }
      }
    ];
    const errors = [];

    for (const attempt of attempts) {
      const path = typeof attempt === "string" ? attempt : attempt.path;
      const options = typeof attempt === "string" ? {} : attempt.options;
      try {
        const data = await this.request(path, options);
        return normalizeFileListResult(data, directory);
      } catch (error) {
        errors.push(error.message || "Unknown error");
        if (!isRetryableFileError(error)) throw error;
      }
    }

    throw new NitradoError(`Could not list Nitrado file directory ${directory}: ${errors.slice(-1)[0] || "Unknown error"}`);
  }

  async downloadFile(filePath) {
    const encodedFile = fileQueryValue(filePath);
    const relativeFile = trimLeadingSlash(filePath);
    const encodedRelativeFile = fileQueryValue(relativeFile);
    const attempts = [
      `/services/${this.serviceId}/gameservers/file_server/download?file=${encodedFile}`,
      `/services/${this.serviceId}/gameservers/file_server/download?path=${encodedFile}`,
      `/services/${this.serviceId}/gameservers/file_server/download?file=${encodedRelativeFile}`,
      `/services/${this.serviceId}/gameservers/file_server/download?path=${encodedRelativeFile}`,
      {
        path: `/services/${this.serviceId}/gameservers/file_server/download`,
        options: {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ file: filePath }).toString()
        }
      },
      {
        path: `/services/${this.serviceId}/gameservers/file_server/download`,
        options: {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ file: relativeFile }).toString()
        }
      }
    ];
    const errors = [];

    for (const attempt of attempts) {
      const path = typeof attempt === "string" ? attempt : attempt.path;
      const options = typeof attempt === "string" ? {} : attempt.options;
      try {
        const response = await this.requestRaw(path, { accept: "text/plain,*/*", ...options });
        if (typeof response.data?.url === "string") {
          return this.downloadExternalFile(response.data.url);
        }

        if (typeof response.data?.content === "string") return response.data.content;
        if (!response.contentType.includes("application/json")) return response.text;
      } catch (error) {
        errors.push(error.message || "Unknown error");
        if (!isRetryableFileError(error)) throw error;
      }
    }

    throw new NitradoError(`Could not download ${filePath}: ${errors.slice(-1)[0] || "Unknown error"}`);
  }

  async downloadExternalFile(url) {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "text/plain,*/*"
      }
    });

    const text = await response.text();
    if (!response.ok) {
      throw new NitradoError(`External file download failed with HTTP ${response.status}.`);
    }

    return text;
  }

  async uploadFile(filePath, content) {
    const encodedFile = fileQueryValue(filePath);
    const relativeFile = trimLeadingSlash(filePath);
    const encodedRelativeFile = fileQueryValue(relativeFile);
    const directory = filePath.split("/").slice(0, -1).join("/") || "/";
    const relativeDirectory = trimLeadingSlash(directory);
    const filename = filePath.split("/").filter(Boolean).pop() || "Game.ini";
    const errors = [];
    const attempts = [
      {
        label: "multipart file path field",
        path: `/services/${this.serviceId}/gameservers/file_server/upload`,
        body: fileUploadFormData({ path: filePath, filename, content })
      },
      {
        label: "multipart directory path field",
        path: `/services/${this.serviceId}/gameservers/file_server/upload`,
        body: fileUploadFormData({ path: directory, filename, content })
      },
      {
        label: "multipart file query",
        path: `/services/${this.serviceId}/gameservers/file_server/upload?file=${encodedFile}`,
        body: fileUploadFormData({ filename, content })
      },
      {
        label: "multipart relative file query",
        path: `/services/${this.serviceId}/gameservers/file_server/upload?file=${encodedRelativeFile}`,
        body: fileUploadFormData({ filename, content })
      },
      {
        label: "multipart directory query",
        path: `/services/${this.serviceId}/gameservers/file_server/upload?path=${fileQueryValue(directory)}`,
        body: fileUploadFormData({ filename, content })
      },
      {
        label: "multipart relative directory query",
        path: `/services/${this.serviceId}/gameservers/file_server/upload?path=${fileQueryValue(relativeDirectory)}`,
        body: fileUploadFormData({ filename, content })
      }
    ];

    for (const attempt of attempts) {
      try {
        await this.request(attempt.path, {
          method: "POST",
          body: attempt.body
        });
        return;
      } catch (error) {
        errors.push(`${attempt.label}: ${error.message || "Unknown error"}`);
        if (!isRetryableFileError(error)) throw error;
      }
    }

    throw new NitradoError(`Could not upload ${filePath}. Last errors: ${errors.slice(-3).join("; ")}`);
  }

  async updateFirstSetting(keys, value, actionLabel, isAllowedKey = () => true, relatedCategoryKeys = [], options = {}) {
    const errors = [];
    await this.ensureSettingsCanBeUpdated(actionLabel);
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
        return await this.updateGameserverSetting(target, value, actionLabel, options);
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

  async ensureSettingsCanBeUpdated(actionLabel) {
    const server = await this.getGameserver();
    if (!isOfflineStatus(server.status)) {
      throw new NitradoError(
        `Nitrado requires the server to be offline before ${actionLabel} settings can be changed. Current status: ${server.status}. Run /server stop, wait until /server status shows stopped/offline, then run this command again. After it succeeds, run /server restart.`
      );
    }
  }

  async updateGameserverSetting(target, value, actionLabel, options = {}) {
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

              if (options.verify) {
                await this.verifyGameserverSetting(key, value, `${method} ${attempt.label}`);
              }

              return {
                action: actionLabel,
                ok: true,
                message:
                  data?.message ||
                  `Nitrado accepted ${actionLabel} for ${key}${category ? ` in ${category}` : ""} via ${method} ${attempt.label}. Run /server restart for the change to apply.`
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

  async verifyGameserverSetting(key, value, attemptLabel) {
    const settings = await this.getGameserverSettings();
    const expected = String(value ?? "");
    const matches = settings.filter((setting) => normalizeKey(setting.key) === normalizeKey(key));
    if (!matches.length) {
      throw new NitradoError(`${key} was accepted via ${attemptLabel}, but ReadSettings did not return ${key} for verification.`);
    }

    const verified = matches.some((setting) => String(setting.value ?? "") === expected);
    if (!verified) {
      const current = matches.map((setting) => maskSettingForError(setting.value)).join(", ");
      throw new NitradoError(`${key} was accepted via ${attemptLabel}, but ReadSettings still shows ${current || "[empty]"}.`);
    }
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

function maskSettingForError(value) {
  return value ? "[set]" : "[empty]";
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
  const stringValue = String(value ?? "");

  if (category) {
    if (isPasswordSetting) {
      return [
        {
          label: `official path value ${category}/${key}`,
          path: `/services/${serviceId}/gameservers/settings/${encodedCategory}/${encodedKey}`,
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ value: stringValue }).toString()
        },
        {
          label: `official path direct ${category}/${key}`,
          path: `/services/${serviceId}/gameservers/settings/${encodedCategory}/${encodedKey}`,
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ [key]: stringValue }).toString()
        },
        {
          label: `category path direct ${category}/${key}`,
          path: `/services/${serviceId}/gameservers/settings/${encodedCategory}`,
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ [key]: stringValue }).toString()
        }
      ];
    }

    attempts.push({
      label: `category path nested settings ${category}/${key}`,
      path: `/services/${serviceId}/gameservers/settings/${encodedCategory}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ [`settings[${key}]`]: stringValue }).toString()
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
      body: new URLSearchParams({ key, value: stringValue }).toString()
    });
    attempts.push({
      label: `multipart category path key/value ${category}/${key}`,
      path: `/services/${serviceId}/gameservers/settings/${encodedCategory}`,
      headers: {},
      body: formData({ key, value: stringValue })
    });
    attempts.push({
      label: `category path direct ${category}/${key}`,
      path: `/services/${serviceId}/gameservers/settings/${encodedCategory}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ [key]: stringValue }).toString()
    });
    attempts.push({
      label: `path ${category}/${key}`,
      path: `/services/${serviceId}/gameservers/settings/${encodedCategory}/${encodedKey}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ value: stringValue }).toString()
    });
    if (!isPasswordSetting) {
      attempts.push({
        label: `form category/key/value ${category}/${key}`,
        path: `/services/${serviceId}/gameservers/settings`,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ category, key, value: stringValue }).toString()
      });
    }
    attempts.push({
      label: `multipart category/key/value ${category}/${key}`,
      path: `/services/${serviceId}/gameservers/settings`,
      headers: {},
      body: formData({ category, key, value: stringValue })
    });
    attempts.push({
      label: `form category nested settings ${category}/${key}`,
      path: `/services/${serviceId}/gameservers/settings`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ category, [`settings[${key}]`]: stringValue }).toString()
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
      body: new URLSearchParams({ [key]: stringValue }).toString()
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

function gamePropertyUpdateAttempts(serviceId, key, value) {
  const path = `/services/${serviceId}/gameservers/games/properties`;
  const stringValue = String(value ?? "");
  const jsonHeaders = { "Content-Type": "application/json" };
  const formHeaders = { "Content-Type": "application/x-www-form-urlencoded" };
  const formValue = (payload) => new URLSearchParams(flattenPayload(payload)).toString();

  return [
    {
      label: "json properties object",
      path,
      headers: jsonHeaders,
      body: JSON.stringify({ properties: { [key]: stringValue } })
    },
    {
      label: "json settings object",
      path,
      headers: jsonHeaders,
      body: JSON.stringify({ settings: { [key]: stringValue } })
    },
    {
      label: "json direct property",
      path,
      headers: jsonHeaders,
      body: JSON.stringify({ [key]: stringValue })
    },
    {
      label: "json key/value",
      path,
      headers: jsonHeaders,
      body: JSON.stringify({ key, value: stringValue })
    },
    {
      label: "form properties key",
      path,
      headers: formHeaders,
      body: new URLSearchParams({ [`properties[${key}]`]: stringValue }).toString()
    },
    {
      label: "form settings key",
      path,
      headers: formHeaders,
      body: new URLSearchParams({ [`settings[${key}]`]: stringValue }).toString()
    },
    {
      label: "form direct property",
      path,
      headers: formHeaders,
      body: formValue({ [key]: stringValue })
    },
    {
      label: "form key/value",
      path,
      headers: formHeaders,
      body: formValue({ key, value: stringValue })
    },
    {
      label: "put json properties object",
      path,
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify({ properties: { [key]: stringValue } })
    },
    {
      label: "patch json properties object",
      path,
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify({ properties: { [key]: stringValue } })
    }
  ];
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

function sanitizeDebugValue(value, keyPath = "") {
  if (Array.isArray(value)) {
    return value.slice(0, 8).map((entry, index) => sanitizeDebugValue(entry, `${keyPath}.${index}`));
  }

  if (!value || typeof value !== "object") {
    if (isSensitiveKey(keyPath)) return value ? "[hidden]" : value;
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 80)
      .map(([key, entryValue]) => {
        const nextKeyPath = keyPath ? `${keyPath}.${key}` : key;
        return [key, isSensitiveKey(nextKeyPath) ? "[hidden]" : sanitizeDebugValue(entryValue, nextKeyPath)];
      })
  );
}

function isSensitiveKey(key) {
  return /password|token|secret|auth|key|credential/i.test(String(key || ""));
}

function normalizeFileEntries(data) {
  const root = data?.entries || data?.files || data?.file_server || data?.list || data;
  const entries = [
    ...(Array.isArray(root) ? root : []),
    ...(Array.isArray(root?.entries) ? root.entries : []),
    ...(Array.isArray(root?.files) ? root.files : []),
    ...(Array.isArray(root?.folders) ? root.folders.map(markDirectoryEntry) : []),
    ...(Array.isArray(root?.directories) ? root.directories.map(markDirectoryEntry) : [])
  ];

  return entries
    .map((entry) => {
      if (typeof entry === "string") {
        return {
          name: entry.split("/").filter(Boolean).pop() || entry,
          path: normalizeFilePath(entry),
          type: looksLikeFile(entry) ? "file" : "dir"
        };
      }

      const name = entry?.name || entry?.basename || entry?.filename || "";
      const path = normalizeFilePath(entry?.path || entry?.file || entry?.dir || name);
      const type = String(entry?.type || entry?.kind || "").toLowerCase();
      const isDirectory = Boolean(entry?.isDirectory || entry?.is_dir || entry?.directory) || type === "dir" || type === "directory";

      return {
        name,
        path,
        type: isDirectory ? "dir" : "file",
        isDirectory
      };
    })
    .filter((entry) => entry.path || entry.name);
}

function markDirectoryEntry(entry) {
  if (typeof entry === "string") return { path: entry, type: "dir", isDirectory: true };
  return { ...entry, type: "dir", isDirectory: true };
}

function normalizeFileListResult(data, path = "/") {
  return {
    path,
    entries: normalizeFileEntries(data),
    rawKeys: objectKeys(data),
    rawType: Array.isArray(data) ? "array" : typeof data
  };
}

function objectKeys(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.keys(value).slice(0, 12);
}

function findNestedValue(value, path) {
  return String(path || "")
    .split(".")
    .filter(Boolean)
    .reduce((current, key) => (current && typeof current === "object" ? current[key] : undefined), value);
}

function normalizeFilePath(path) {
  const value = String(path || "").replace(/\\/g, "/").replace(/\/+/g, "/");
  if (!value || value === ".") return "";
  return value.startsWith("/") ? value : `/${value}`;
}

function normalizeNitradoInputPath(path) {
  const cleaned = String(path || "/").trim().replace(/^:+/, "");
  return normalizeFilePath(cleaned || "/");
}

function trimLeadingSlash(path) {
  return String(path || "").replace(/^\/+/, "");
}

function fileQueryValue(path) {
  return encodeURI(String(path || "")).replace(/#/g, "%23").replace(/\?/g, "%3F").replace(/&/g, "%26");
}

function looksLikeFile(path) {
  return /\.[a-z0-9]{2,8}$/i.test(String(path || ""));
}

function isLikelyConfigDirectory(path) {
  const normalized = normalizeKey(path);
  return (
    normalized.includes("chivalry") ||
    normalized.includes("chiv") ||
    normalized.includes("saved") ||
    normalized.includes("config") ||
    normalized.includes("linuxserver") ||
    normalized.includes("windowsserver")
  );
}

function isLikelyChivalryConfigFile(path) {
  const normalized = normalizeFilePath(path).toLowerCase();
  return (
    normalized.endsWith("/game.ini") ||
    normalized.endsWith("/gameserver.ini") ||
    normalized.endsWith("/serversettings.ini")
  );
}

function readIniValue(content, key) {
  const pattern = new RegExp(`^(${escapeRegExp(key)}\\s*=)(.*)$`, "im");
  const match = String(content || "").match(pattern);
  return match ? match[2].trim() : "";
}

function updateIniValue(content, key, value) {
  const text = String(content || "");
  const stringValue = String(value ?? "");
  const pattern = new RegExp(`^(${escapeRegExp(key)}\\s*=).*$`, "im");

  if (pattern.test(text)) {
    return text.replace(pattern, `$1${stringValue}`);
  }

  const lineEnding = text.includes("\r\n") ? "\r\n" : "\n";
  const prefix = text.endsWith("\n") || !text ? "" : lineEnding;
  return `${text}${prefix}${key}=${stringValue}${lineEnding}`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formData(fields) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    data.append(key, value);
  }
  return data;
}

function fileUploadFormData({ path, filename, content }) {
  const data = new FormData();
  if (path) data.append("path", path);
  data.append("file", new Blob([content], { type: "text/plain" }), filename);
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

function isOfflineStatus(status) {
  const normalized = String(status || "").toLowerCase();
  return ["stopped", "stop", "offline", "suspended"].includes(normalized);
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
    message.includes("accepted via") ||
    message.includes("readsettings") ||
    message.includes("invalid") ||
    message.includes("unknown")
  );
}

function isRetryablePropertyError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    error?.statusCode === 400 ||
    error?.statusCode === 404 ||
    error?.statusCode === 405 ||
    error?.statusCode === 422 ||
    message.includes("not found") ||
    message.includes("invalid") ||
    message.includes("unknown") ||
    message.includes("property") ||
    message.includes("properties") ||
    message.includes("key") ||
    message.includes("value")
  );
}

function isRetryableFileError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    error?.statusCode === 400 ||
    error?.statusCode === 404 ||
    error?.statusCode === 405 ||
    error?.statusCode === 422 ||
    message.includes("not found") ||
    message.includes("could not download") ||
    message.includes("could not list") ||
    message.includes("http 404") ||
    message.includes("invalid") ||
    message.includes("unknown") ||
    message.includes("file") ||
    message.includes("path")
  );
}
