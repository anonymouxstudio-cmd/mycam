// =========================================================
// Anonymoux Studio — server.js
// Lucy 2.5 realtime backend
// =========================================================

require("dotenv").config();

const express = require("express");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 3000;
const FAL_KEY = process.env.FAL_KEY;

const LUCY_APP = "decart/lucy-2-5/realtime";

// =========================================================
// Startup
// =========================================================

if (!FAL_KEY) {
  console.error(
    "[ERROR] FAL_KEY is not configured."
  );
} else {
  console.log(
    "[OK] FAL_KEY is configured."
  );
}

// JSON body parser for token endpoint.
app.use(
  express.json({
    limit: "1mb"
  })
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
      lucy: LUCY_APP,
      falKeyConfigured: Boolean(FAL_KEY),
      realtimeTokenEndpoint:
        "/api/fal/realtime-token"
    });

  }
);

// =========================================================
// Lucy 2.5 realtime token
// =========================================================
//
// The browser NEVER receives FAL_KEY.
//
// Browser:
//   POST /api/fal/realtime-token
//
// Server:
//   POST https://rest.fal.ai/tokens/realtime
//   Authorization: Key FAL_KEY
//
// Server returns the short-lived token to browser.
// =========================================================

app.post(
  "/api/fal/realtime-token",
  async (req, res) => {

    if (!FAL_KEY) {

      console.error(
        "[token] FAL_KEY is missing."
      );

      return res.status(500).json({
        error:
          "Server is missing FAL_KEY."
      });

    }

    const requestedApp =
      req.body &&
      req.body.app;

    // -------------------------------------------------------
    // Only allow our Lucy endpoint.
    // -------------------------------------------------------

    if (
      requestedApp &&
      requestedApp !== LUCY_APP
    ) {

      console.error(
        "[token] Blocked app:",
        requestedApp
      );

      return res.status(403).json({
        error:
          "Realtime app is not allowed."
      });

    }

    try {

      console.log(
        "[token] Requesting Lucy realtime token..."
      );

      const response =
        await fetch(
          "https://rest.fal.ai/tokens/realtime",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",

              "Authorization":
                `Key ${FAL_KEY}`
            },

            body: JSON.stringify({

              allowed_apps: [
                LUCY_APP
              ],

              // Token lifetime.
              // The frontend uses the same value.
              duration: 120

            })
          }
        );

      const text =
        await response.text();

      console.log(
        `[token] fal.ai response: ${response.status}`
      );

      if (!response.ok) {

        console.error(
          "[token] fal.ai error:",
          text.slice(0, 1000)
        );

        return res.status(
          response.status
        ).json({
          error:
            "fal.ai realtime token request failed.",
          details:
            text
        });

      }

      let data;

      try {

        data =
          JSON.parse(text);

      } catch {

        return res.status(502).json({
          error:
            "fal.ai returned an invalid token response."
        });

      }

      if (!data.token) {

        console.error(
          "[token] No token in fal.ai response."
        );

        return res.status(502).json({
          error:
            "fal.ai did not return a realtime token."
        });

      }

      console.log(
        "[token] Realtime token created."
      );

      // Return ONLY the token.
      //
      // This matches the frontend tokenProvider:
      // return response.text();
      //
      res
        .type("text/plain")
        .send(data.token);

    } catch (error) {

      console.error(
        "[token] Server error:",
        error
      );

      return res.status(502).json({
        error:
          "Could not contact fal.ai.",
        message:
          error.message
      });

    }

  }
);

// =========================================================
// Optional fal HTTP proxy
// =========================================================
//
// Kept here for normal fal client requests.
// Lucy realtime authentication above uses the
// short-lived token endpoint instead.
// =========================================================

const ALLOWED_HOSTS = [
  "fal.run",
  "queue.fal.run",
  "fal.ai",
  "api.fal.ai",
  "rest.fal.ai",
  "rest.alpha.fal.ai"
];

function isAllowedTarget(
  targetUrl
) {

  try {

    const url =
      new URL(targetUrl);

    const hostname =
      url.hostname.toLowerCase();

    return ALLOWED_HOSTS.some(
      (allowed) =>
        hostname === allowed ||
        hostname.endsWith(
          "." + allowed
        )
    );

  } catch {

    return false;

  }

}

// IMPORTANT:
// express.raw must be attached before this route
// so binary/raw requests from fal can pass through.

app.all(
  "/api/fal/proxy/*",
  express.raw({
    type: "*/*",
    limit: "50mb"
  }),
  async (req, res) => {

    const targetUrl =
      req.headers[
        "x-fal-target-url"
      ];

    if (!targetUrl) {

      return res.status(400).json({
        error:
          "Missing x-fal-target-url header."
      });

    }

    if (
      !isAllowedTarget(targetUrl)
    ) {

      console.error(
        "[proxy] Blocked target:",
        targetUrl
      );

      return res.status(412).json({
        error:
          "Target URL is not allowed."
      });

    }

    if (!FAL_KEY) {

      return res.status(500).json({
        error:
          "Server is missing FAL_KEY."
      });

    }

    const method =
      req.method.toUpperCase();

    if (
      ![
        "GET",
        "POST",
        "PUT",
        "DELETE",
        "PATCH"
      ].includes(method)
    ) {

      return res.status(405).json({
        error:
          "Method Not Allowed."
      });

    }

    try {

      const target =
        new URL(targetUrl);

      const headers = {
        ...req.headers
      };

      delete headers.host;
      delete headers.connection;
      delete headers[
        "content-length"
      ];

      headers.authorization =
        `Key ${FAL_KEY}`;

      headers.host =
        target.host;

      console.log(
        `[proxy] ${method} ${targetUrl}`
      );

      const upstream =
        await fetch(
          targetUrl,
          {
            method,
            headers,

            body:
              [
                "GET",
                "HEAD"
              ].includes(method)
                ? undefined
                : req.body,

            redirect:
              "follow"
          }
        );

      console.log(
        `[proxy] ${upstream.status}`
      );

      res.status(
        upstream.status
      );

      upstream.headers.forEach(
        (value, key) => {

          if (
            [
              "content-length",
              "content-encoding",
              "transfer-encoding",
              "connection"
            ].includes(key)
          ) {
            return;
          }

          res.setHeader(
            key,
            value
          );

        }
      );

      const buffer =
        await upstream.arrayBuffer();

      res.send(
        Buffer.from(buffer)
      );

    } catch (error) {

      console.error(
        "[proxy] Error:",
        error
      );

      if (!res.headersSent) {

        res.status(502).json({
          error:
            "Upstream request failed.",
          message:
            error.message
        });

      }

    }

  }
);

// =========================================================
// Static frontend
// =========================================================

app.use(
  express.static(
    path.join(__dirname)
  )
);

// =========================================================
// SPA fallback
// =========================================================

app.get(
  "*",
  (req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        "index.html"
      )
    );

  }
);

// =========================================================
// Start
// =========================================================

app.listen(
  PORT,
  () => {

    console.log("");
    console.log(
      "=========================================="
    );
    console.log(
      "        ANONYMOUX STUDIO"
    );
    console.log(
      "=========================================="
    );
    console.log(
      `Port: ${PORT}`
    );
    console.log(
      `Lucy: ${LUCY_APP}`
    );
    console.log(
      `FAL_KEY: ${
        FAL_KEY
          ? "configured"
          : "MISSING"
      }`
    );
    console.log(
      "Realtime token endpoint: ENABLED"
    );
    console.log(
      "Custom WebSocket proxy: DISABLED"
    );
    console.log(
      "=========================================="
    );
    console.log("");

  }
);
