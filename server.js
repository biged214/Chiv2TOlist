import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 3000;
const clientDir = __dirname;

app.use(express.static(clientDir));

app.use((_request, response) => {
  response.sendFile(path.join(clientDir, "index.html"));
});

app.listen(port, () => {
  console.log(`Chiv2 tier list server running on port ${port}`);
});
