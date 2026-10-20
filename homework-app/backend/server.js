const http = require("http");
const { Pool } = require("pg");

const port = Number(process.env.PORT || 3000);
const apiPrefix = process.env.API_PREFIX || "/api";
const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
});

async function initialiseDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS todos (
      id SERIAL PRIMARY KEY,
      text VARCHAR(255) NOT NULL,
      completed BOOLEAN NOT NULL DEFAULT FALSE
    )
  `);
}

function sendJson(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString() || "{}");
}

const server = http.createServer(async (request, response) => {
  try {
    const path = request.url.startsWith(apiPrefix)
      ? request.url.slice(apiPrefix.length) || "/"
      : request.url;

    if (request.method === "GET" && request.url === "/live") {
      return sendJson(response, 200, { status: "alive" });
    }

    if (request.method === "GET" && request.url === "/health") {
      await pool.query("SELECT 1");
      return sendJson(response, 200, { status: "ok" });
    }

    if (request.method === "GET" && path === "/todos") {
      const result = await pool.query("SELECT * FROM todos ORDER BY id");
      return sendJson(response, 200, result.rows);
    }

    if (request.method === "POST" && path === "/todos") {
      const { text } = await readJson(request);
      if (!text || !text.trim()) return sendJson(response, 400, { error: "Text is required" });
      const result = await pool.query(
        "INSERT INTO todos (text) VALUES ($1) RETURNING *",
        [text.trim()]
      );
      return sendJson(response, 201, result.rows[0]);
    }

    const match = path.match(/^\/todos\/(\d+)$/);
    if (request.method === "PATCH" && match) {
      const result = await pool.query(
        "UPDATE todos SET completed = NOT completed WHERE id = $1 RETURNING *",
        [match[1]]
      );
      if (!result.rowCount) return sendJson(response, 404, { error: "Todo not found" });
      return sendJson(response, 200, result.rows[0]);
    }

    if (request.method === "DELETE" && match) {
      await pool.query("DELETE FROM todos WHERE id = $1", [match[1]]);
      response.writeHead(204);
      return response.end();
    }

    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: "Internal server error" });
  }
});

async function start() {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      await initialiseDatabase();
      server.listen(port, "0.0.0.0", () => console.log(`Backend listening on ${port}`));
      return;
    } catch (error) {
      console.log(`Database not ready (attempt ${attempt}/30); retrying...`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  throw new Error("Could not connect to PostgreSQL");
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
