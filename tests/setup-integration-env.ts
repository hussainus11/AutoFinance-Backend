import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Force-override (unlike dotenv.config()'s default skip-if-already-set) so this always wins
// over whatever `../src/prisma.js`'s own `import "dotenv/config"` would load from `.env`,
// regardless of module evaluation order.
const testEnv = dotenv.parse(fs.readFileSync(path.resolve(__dirname, "../.env.test")));
for (const [key, value] of Object.entries(testEnv)) {
  process.env[key] = value;
}

process.env.JWT_SECRET = process.env.JWT_SECRET || "integration-test-secret-0123456789abcdef";
process.env.COOKIE_SECURE = "false";
