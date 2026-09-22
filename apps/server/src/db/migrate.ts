import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db } from "../config/database.js";
try {
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Database migrations completed");
} finally {
  await db.$client.end();
}
