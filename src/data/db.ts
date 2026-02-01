import { SQL } from "bun"

/**
 * Database connection using Bun's native Postgres driver.
 * Reads DATABASE_URL from environment.
 */
const databaseUrl = Bun.env.DATABASE_URL
if (!databaseUrl) {
  console.warn("DATABASE_URL not set - database features will be unavailable")
}

/**
 * The database connection pool.
 * Will be undefined if DATABASE_URL is not set.
 */
export const sql = databaseUrl ? new SQL(databaseUrl) : null

/**
 * Check if the database is available.
 */
export function isDatabaseAvailable(): boolean {
  return sql !== null
}

/**
 * Run the migration SQL on startup.
 * Reads migration files from the migrations directory and executes them.
 */
export async function runMigrations(): Promise<void> {
  if (!sql) {
    console.warn("Skipping migrations - database not available")
    return
  }

  const migrationsDir = `${import.meta.dir}/../../migrations`

  try {
    // Create migrations tracking table if it doesn't exist
    await sql`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `

    // Read migration files
    const glob = new Bun.Glob("*.sql")
    const migrationFiles: string[] = []
    for await (const file of glob.scan(migrationsDir)) {
      migrationFiles.push(file)
    }
    migrationFiles.sort()

    for (const filename of migrationFiles) {
      // Check if migration has already been applied
      const [existing] = await sql`
        SELECT version FROM schema_migrations WHERE version = ${filename}
      `
      
      if (existing) {
        console.log(`  ✓ ${filename} (already applied)`)
        continue
      }

      // Read and execute the migration
      const migrationPath = `${migrationsDir}/${filename}`
      const migrationSql = await Bun.file(migrationPath).text()

      console.log(`  → Applying ${filename}...`)
      
      // Execute as a transaction
      await sql.begin(async (tx) => {
        // Split by semicolons and execute each statement
        // This is needed because Bun.sql doesn't support multi-statement queries
        const statements = migrationSql
          .split(";")
          .map((s) => s.trim())
          .filter((s) => {
            // Remove empty statements
            if (s.length === 0) return false
            // Remove comment-only statements (strip all -- lines and check if anything remains)
            const withoutComments = s
              .split("\n")
              .filter((line) => !line.trim().startsWith("--"))
              .join("\n")
              .trim()
            return withoutComments.length > 0
          })

        for (const statement of statements) {
          await tx.unsafe(statement)
        }

        // Record the migration
        await tx`
          INSERT INTO schema_migrations (version) VALUES (${filename})
        `
      })

      console.log(`  ✓ ${filename}`)
    }

    console.log("Database migrations complete")
  } catch (error) {
    console.error("Migration failed:", error)
    throw error
  }
}

/**
 * Close the database connection.
 */
export async function closeDatabase(): Promise<void> {
  if (sql) {
    await sql.close()
  }
}
