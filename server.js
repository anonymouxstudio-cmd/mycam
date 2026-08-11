// =========================================================
// Anonymoux Studio — backend
// =========================================================
// This is a minimal Express server that does two things:
//
// 1. Serves the static frontend from the repo root
// 2. Implements fal.ai's documented server-side proxy so the
//    browser never sees your FAL_KEY.
//    Docs: https://fal.ai/docs/documentation/model-apis/inference/proxy-setup
//
// The frontend talks to /api/fal/proxy/*, which forwards the
// request to the real fal.ai endpoint (given in the
// x-fal-target-url header by the @fal-ai/client SDK) with your
// API key attached server-side.
// =========================================================

const express = require("express");
const fetch = require("node-fetch");

const PORT = process.env.PORT || 3000;
const FAL_KEY = process.env.FAL_KEY;

if (!FAL_KEY) {
  console.warn(
    "[warn] FAL_KEY is not set. Export it before starting the server:\n" +
      "  export FAL_KEY=your_fal_api_key\n" +
      "Get a key at https://fal.ai/dashboard/keys"
  );
}

const app = express();

// fal's client sends raw bodies (often binary/multipart), so we
// use express.raw() instead of express.json() for the proxy route.
app.use("/api/fal/proxy", express.raw({ type: "*/*", limit: "50mb" }));

// Restrict which fal apps this proxy is allowed to call.
// Add more glob patterns here if you wire up other fal models.
const ALLOWED_ENDPOINTS = ["decart/lucy-2-5/**", "decart/lucy2-vton/**"];

function isAllowedEndpoint(targetUrl) {
  try {
    const path = new URL(targetUrl).pathname.replace(/^\//, "");
    return ALLOWED_ENDPOINTS.some((pattern) => {
      const regex = new RegExp(
        "^" + pattern.replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*") + "$"
      );
      return regex.test(path);
    });
  } catch {
    return false;
  }
}

app.all("/api/fal/proxy/*", async (req, res) => {
  const targetUrl = req.headers["x-fal-target-url"];

  if (!targetUrl) {
    return res.status(400).json({ error: "Missing x-fal-target-url header" });
  }

  if (!isAllowedEndpoint(targetUrl)) {
    return res.status(403).json({ error: "Endpoint not allowlisted on this proxy" });
  }

  if (!FAL_KEY) {
    return res.status(500).json({ error: "Server is missing FAL_KEY" });
  }

  try {
    const forwardHeaders = { ...req.headers };
    delete forwardHeaders.host;
    delete forwardHeaders["content-length"];
    forwardHeaders["authorization"] = `Key ${FAL_KEY}`;

    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers: forwardHeaders,
      body: ["GET", "HEAD"].includes(req.method) ? undefined : req.body,
    });

    res.status(upstream.status);
    upstream.headers.forEach((value, key) => {
      // Let Express/Node manage these instead of copying blindly.
      if (!["content-encoding", "transfer-encoding", "connection"].includes(key)) {
        res.setHeader(key, value);
      }
    });

    const buffer = await upstream.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error("Proxy error:", error);
    res.status(502).json({ error: "Upstream request to fal.ai failed" });
  }
});

app.use(express.static("."));

app.listen(PORT, () => {
  console.log(`Anonymoux Studio running at http://localhost:${PORT}`);
});
