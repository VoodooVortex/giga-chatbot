import { defineConfig } from "drizzle-kit";
import { env } from "./src/lib/config";

export default defineConfig({
    schema: "./src/lib/db/schema.ts",
    out: "./drizzle/migrations",
    dialect: "postgresql",
    dbCredentials: {
        url: env.DATABASE_URL,
    },
    verbose: true,
    strict: true,
});