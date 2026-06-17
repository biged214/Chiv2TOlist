import { getBotConfig } from "../env.js";
import { NitradoClient } from "./client.js";

const config = getBotConfig();

if (!config.nitradoToken) {
  console.error("Missing required env var: NITRADO_TOKEN");
  process.exitCode = 1;
} else {
  const client = new NitradoClient({
    token: config.nitradoToken,
    serviceId: config.nitradoServiceId
  });

  try {
    const services = await client.listServices();

    if (!services.length) {
      console.log("No Nitrado services were returned for this token.");
    } else {
      for (const service of services) {
        const detailText = Object.entries(service.details || {})
          .filter(([, value]) => typeof value === "string" || typeof value === "number")
          .slice(0, 4)
          .map(([key, value]) => `${key}=${value}`)
          .join(" ");

        console.log(
          [
            `id=${service.id || "unknown"}`,
            service.type ? `type=${service.type}` : "",
            service.status ? `status=${service.status}` : "",
            detailText
          ]
            .filter(Boolean)
            .join(" ")
        );
      }
    }
  } catch (error) {
    console.error(`Could not list Nitrado services: ${error.message || "Unknown error."}`);
    process.exitCode = 1;
  }
}
