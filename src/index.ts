import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { z } from "zod";
import { apiRouter } from "./apiRouter.js";
import { apiLimiter } from "./rate-limit.js";
import { startProcessScheduler } from "./services/process-scheduler.js";
import { createServer } from "node:http";
import { initRealtime } from "./realtime.js";

const app = express();
const corsOrigin = process.env.CORS_ORIGIN;
app.use(
  cors({
    origin: corsOrigin ? corsOrigin.split(",").map((s) => s.trim()) : true,
    credentials: true
  })
);
app.use(cookieParser());
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as any).rawBody = buf;
    }
  })
);

app.use("/api", apiLimiter, apiRouter);

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: "Validation error", details: err.flatten() });
    return;
  }
  res.status(500).json({ error: err instanceof Error ? err.message : "Server error" });
});

const port = Number(process.env.PORT) || 4000;
const httpServer = createServer(app);
initRealtime(httpServer, corsOrigin);

httpServer.listen(port, () => {
  console.log(`Auto Finance API http://localhost:${port}/api`);
  startProcessScheduler();
});
