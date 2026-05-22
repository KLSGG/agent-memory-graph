import Database from 'better-sqlite3';
export declare class SchemaManager {
    private db;
    constructor(dbPath: string);
    /** Initialize schema (idempotent) */
    initialize(): Database.Database;
    /** Get current schema version */
    getVersion(): number;
    /** Close database connection */
    close(): void;
}
//# sourceMappingURL=schema.d.ts.map