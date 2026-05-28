// Netlify Functions entry point. Wraps the same Express app the EC2 server
// uses, but backs it with Netlify Blobs instead of a JSON file on disk.
//
// The `/api/*` redirect in netlify.toml proxies the original URL into this
// function, so Express still sees `/api/...` paths and the routes match
// without any rewriting.

import express from "express";
import cors from "cors";
import serverless from "serverless-http";
import { createRouter, deriveSessionSecret } from "../../../server/src/routes.js";
import { createBlobsStorage } from "./storage-blobs.js";

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "1013";
const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  deriveSessionSecret(ADMIN_USERNAME, ADMIN_PASSWORD);

const storage = createBlobsStorage("volunteer-data", "main");

const app = express();
app.use(cors());
app.use(express.json({ limit: "200kb" }));

app.use(
  "/api",
  createRouter({
    ...storage,
    adminUsername: ADMIN_USERNAME,
    adminPassword: ADMIN_PASSWORD,
    sessionSecret: SESSION_SECRET,
  })
);

export const handler = serverless(app);
