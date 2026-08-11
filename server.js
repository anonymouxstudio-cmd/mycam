// =========================================================
// Anonymoux Studio — backend
// =========================================================

require("dotenv").config();

const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const FAL_KEY = process.env.FAL_KEY;

if (!FAL_KEY) {
  console.error(
    "[ERROR] FAL_KEY is not set."
  );
}

const app = express();
const server = http.createServer(app);

const ALLOWED_HOSTS = [
  "fal.run",
  "queue.fal.run",
  "api.fal.ai",
  "rest.alpha.fal.ai",
  "fal.ai"
];

function isAllowedEndpoint(targetUrl) {
  try {
    const url = new URL(targetUrl);

    return ALLOWED_HOSTS.some(
      (allowed) =>
        url.hostname === allowed ||
        url.hostname.endsWith("." + allowed)
    );
  } catch {
    return false;
  }
}

// =========================================================
// HTTP proxy
// =========================================================

app.all(
  "/api/fal/proxy/*",
  express.raw({
    type: "*/*",
    limit: "50mb"
  }),
  async (req, res) => {

    const targetUrl =
      req.headers["x-fal-target-url"];

    if (!targetUrl) {
      return res.status(400).json({
        error:
          "Missing x-fal-target-url header"
      });
    }

    if (!isAllowedEndpoint(targetUrl)) {
      console.error(
        "[proxy] Blocked target:",
        targetUrl
      );

      return res.status(403).json({
        error:
          "Endpoint not allowlisted on this proxy"
      });
    }

    if (!FAL_KEY) {
      return res.status(500).json({
        error:
          "Server is missing FAL_KEY"
      });
    }

    try {

      const headers = {
        ...req.headers
      };

      delete headers.host;
      delete headers["content-length"];
      delete headers.connection;

      headers.authorization =
        `Key ${FAL_KEY}`;

      console.log(
        `[proxy] ${req.method} ${targetUrl}`
      );

      const response = await fetch(
        targetUrl,
        {
          method: req.method,
          headers,
          body:
            ["GET", "HEAD"].includes(req.method)
              ? undefined
              : req.body
        }
      );

      console.log(
        `[proxy] upstream status: ${response.status}`
      );

      res.status(response.status);

      response.headers.forEach(
        (value, key) => {

          if (
            ![
              "content-encoding",
              "transfer-encoding",
              "connection"
            ].includes(key)
          ) {
            res.setHeader(key, value);
          }

        }
      );

      const data =
        await response.arrayBuffer();

      res.send(
        Buffer.from(data)
      );

    } catch (error) {

      console.error(
        "[proxy] HTTP error:",
        error
      );

      res.status(502).json({
        error:
          "Upstream request to fal.ai failed",
        message:
          error.message
      });
    }
  }
);

// =========================================================
// WebSocket proxy
// =========================================================

const wss = new WebSocket.Server({
  noServer: true
});

server.on(
  "upgrade",
  async (req, socket, head) => {

    try {

      const pathname =
        new URL(
          req.url,
          `http://${req.headers.host}`
        ).pathname;

      /*
       * Only handle fal realtime proxy requests.
       */

      if (
        !pathname.startsWith(
          "/api/fal/proxy"
        )
      ) {
        socket.destroy();
        return;
      }

      const targetUrl =
        req.headers["x-fal-target-url"];

      if (!targetUrl) {

        console.error(
          "[ws] Missing x-fal-target-url"
        );

        socket.destroy();
        return;
      }

      if (
        !isAllowedEndpoint(targetUrl)
      ) {

        console.error(
          "[ws] Blocked target:",
          targetUrl
        );

        socket.destroy();
        return;
      }

      if (!FAL_KEY) {
        socket.destroy();
        return;
      }

      console.log(
        "[ws] Browser requested:",
        targetUrl
      );

      /*
       * The x-fal-target-url may use https/wss.
       *
       * Convert HTTP(S) -> WebSocket protocol.
       */

      const upstreamUrl =
        targetUrl
          .replace(/^https:/, "wss:")
          .replace(/^http:/, "ws:");

      console.log(
        "[ws] Connecting upstream:",
        upstreamUrl
      );

      /*
       * Authenticate the upstream WebSocket.
       */

      const upstream =
        new WebSocket(
          upstreamUrl,
          {
            headers: {
              Authorization:
                `Key ${FAL_KEY}`
            }
          }
        );

      /*
       * Complete browser WebSocket handshake.
       */

      wss.handleUpgrade(
        req,
        socket,
        head,
        (client) => {

          wss.emit(
            "connection",
            client,
            req,
            upstream
          );

        }
      );

    } catch (error) {

      console.error(
        "[ws] Upgrade error:",
        error
      );

      socket.destroy();
    }
  }
);

// =========================================================
// WebSocket bridge
// =========================================================

wss.on(
  "connection",
  (client, req, upstream) => {

    console.log(
      "[ws] Client connected"
    );

    let upstreamReady = false;
    const queuedMessages = [];

    /*
     * Upstream connected.
     */

    upstream.on(
      "open",
      () => {

        upstreamReady = true;

        console.log(
          "[ws] Connected to fal.ai"
        );

        /*
         * Send anything the browser sent
         * while upstream was connecting.
         */

        while (
          queuedMessages.length > 0
        ) {

          const message =
            queuedMessages.shift();

          if (
            upstream.readyState ===
            WebSocket.OPEN
          ) {
            upstream.send(message);
          }

        }
      }
    );

    /*
     * Browser -> fal.ai
     */

    client.on(
      "message",
      (data, isBinary) => {

        if (
          upstreamReady &&
          upstream.readyState ===
            WebSocket.OPEN
        ) {

          upstream.send(
            data,
            {
              binary: isBinary
            }
          );

        } else {

          queuedMessages.push(
            data
          );

        }
      }
    );

    /*
     * fal.ai -> Browser
     */

    upstream.on(
      "message",
      (data, isBinary) => {

        if (
          client.readyState ===
          WebSocket.OPEN
        ) {

          client.send(
            data,
            {
              binary: isBinary
            }
          );

        }

      }
    );

    /*
     * Upstream error.
     */

    upstream.on(
      "error",
      (error) => {

        console.error(
          "[ws] fal.ai error:",
          error.message
        );

        if (
          client.readyState ===
          WebSocket.OPEN
        ) {

          client.close(
            1011,
            "Upstream fal.ai error"
          );

        }

      }
    );

    /*
     * Upstream closed.
     */

    upstream.on(
      "close",
      (code, reason) => {

        console.log(
          `[ws] fal.ai closed: ${code}`,
          reason?.toString() || ""
        );

        if (
          client.readyState ===
          WebSocket.OPEN
        ) {

          client.close(
            code || 1000,
            reason?.toString() || ""
          );

        }

      }
    );

    /*
     * Browser closed.
     */

    client.on(
      "close",
      (code, reason) => {

        console.log(
          `[ws] Browser closed: ${code}`,
          reason?.toString() || ""
        );

        if (
          upstream.readyState ===
            WebSocket.OPEN ||
          upstream.readyState ===
            WebSocket.CONNECTING
        ) {

          upstream.close();

        }

      }
    );

    /*
     * Browser error.
     */

    client.on(
      "error",
      (error) => {

        console.error(
          "[ws] Browser error:",
          error.message
        );

        if (
          upstream.readyState ===
            WebSocket.OPEN ||
          upstream.readyState ===
            WebSocket.CONNECTING
        ) {

          upstream.close();

        }

      }
    );
  }
);

// =========================================================
// Health check
// =========================================================

app.get(
  "/api/health",
  (req, res) => {

    res.json({
      ok: true,
      service: "Anonymoux Studio",
      websocketProxy: true,
      falKeyConfigured: Boolean(
        FAL_KEY
      )
    });

  }
);

// =========================================================
// Static frontend
// =========================================================

app.use(
  express.static(".")
);

// =========================================================
// Start
// =========================================================

server.listen(
  PORT,
  () => {

    console.log("");
    console.log(
      "===================================="
    );
    console.log(
      "       ANONYMOUX STUDIO"
    );
    console.log(
      "===================================="
    );
    console.log(
      `HTTP: http://localhost:${PORT}`
    );
    console.log(
      "WebSocket proxy: ENABLED"
    );
    console.log(
      `FAL key: ${
        FAL_KEY
          ? "configured"
          : "MISSING"
      }`
    );
    console.log(
      "===================================="
    );
    console.log("");

  }
);
